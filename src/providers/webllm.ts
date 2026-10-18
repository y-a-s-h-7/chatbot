/**
 * In-browser inference with WebLLM. This is the honest "zero setup" path: no
 * key, no login, no network round trip for prompts — but a real download the
 * first time, and it needs WebGPU.
 *
 * The library (and its multi-megabyte bundle) is imported lazily so it never
 * lands in the initial page load.
 */

import { toChatCompletions } from './messages';
import { PROVIDERS } from './providers';
import { ProviderError } from './errors';
import { formatDataSize } from '../lib/utils';
import type { ChatProvider, ModelInfo, ProviderMessage, StreamEvent, StreamOptions } from './types';
import { MODELS } from './models';

const ENTRY = PROVIDERS.browser;

type WebLlmModule = typeof import('@mlc-ai/web-llm');
type Engine = import('@mlc-ai/web-llm').MLCEngine;
type AppConfig = import('@mlc-ai/web-llm').AppConfig;

let modulePromise: Promise<WebLlmModule> | null = null;
let engine: Engine | null = null;
let loadedModel: string | null = null;
let loadingPromise: Promise<void> | null = null;

/**
 * Download progress is surfaced through the provider's own `status` events (the
 * generator below drains this variable), so no listener registry is needed here
 * and nothing can be left subscribed after a component unmounts.
 */
let lastProgress: { text: string; progress: number } | null = null;

function setProgress(value: { text: string; progress: number } | null) {
  lastProgress = value;
}

export function hasWebGpu(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

function requireWebGpu(): void {
  if (!hasWebGpu()) {
    throw new ProviderError(
      'webgpu_unavailable',
      'This browser has no **WebGPU**, so it cannot run a model locally. Use Chrome or Edge 113+ on desktop, or pick a cloud model — a free one needs no key.',
      { providerLabel: ENTRY.name, retryable: false },
    );
  }
}

async function loadModule(): Promise<WebLlmModule> {
  if (!modulePromise) {
    modulePromise = import('@mlc-ai/web-llm').catch(() => {
      modulePromise = null;
      throw new ProviderError('unsupported', 'The in-browser runtime failed to load. Reload the page and try again.', {
        providerLabel: ENTRY.name,
      });
    });
  }
  return modulePromise;
}

/** Model IDs WebLLM actually ships, so we never offer an ID it cannot fetch. */
export async function availableBrowserModels(): Promise<Set<string>> {
  try {
    const mod = await loadModule();
    const known = new Set<string>();
    for (const entry of mod.prebuiltAppConfig.model_list as Array<{ model_id?: string }>) {
      if (entry.model_id) known.add(entry.model_id);
    }
    return known;
  } catch {
    return new Set(MODELS.filter((m) => m.provider === 'browser').map((m) => m.id));
  }
}

/**
 * Downloads are the one part of this app that is slow and expensive, so the
 * weights go into IndexedDB rather than the default Cache API store: it survives
 * a reload, a terminal restart and a dev-server bounce, and it is what
 * `deleteModelAllInfoInCache` below clears. Every cache query has to be handed
 * this same config — with the default one it inspects the other store and
 * reports a false miss, which would re-download the model for no reason.
 */
function durableAppConfig(mod: WebLlmModule): AppConfig {
  return { ...mod.prebuiltAppConfig, cacheBackend: 'indexeddb' };
}

let persistRequest: Promise<boolean> | null = null;

/**
 * Asks the browser to keep this origin's storage. Best effort and never throws:
 * without it a browser under storage pressure is free to evict the weights, and
 * the next visit starts the download over again.
 */
function requestPersistentStorage(): Promise<boolean> {
  if (!persistRequest) {
    persistRequest = (async () => {
      try {
        if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      } catch {
        return false;
      }
    })();
  }
  return persistRequest;
}

async function isCached(mod: WebLlmModule, model: string, appConfig: AppConfig): Promise<boolean> {
  try {
    return await mod.hasModelInCache(model, appConfig);
  } catch {
    return false;
  }
}

/**
 * The line the user watches for the first few seconds. Saying which of the two
 * things is happening — reading the cache or pulling hundreds of megabytes over
 * the network — is the difference between "slow" and "broken".
 */
async function loadingMessage(
  mod: WebLlmModule,
  model: string,
  appConfig: AppConfig,
  persistent: boolean,
): Promise<string> {
  const entry = MODELS.find((m) => m.provider === 'browser' && m.id === model);
  const label = entry ? entry.label.replace(' (in-browser)', '') : model;
  if (await isCached(mod, model, appConfig)) return `Loading ${label} from the local cache…`;
  const size = entry?.downloadMB ? formatDataSize(entry.downloadMB) : 'a few hundred megabytes';
  const caveat = persistent ? '' : ' Your browser may clear it again when storage runs low.';
  return `Downloading ${label} once (${size}) — it is kept on this device, so this only happens the first time.${caveat}`;
}

async function ensureEngine(model: string, signal: AbortSignal): Promise<Engine> {
  requireWebGpu();
  const mod = await loadModule();

  if (engine && loadedModel && loadedModel !== model) {
    await engine.unload();
    engine = null;
    loadedModel = null;
  }
  if (engine && loadedModel === model) return engine;

  if (loadingPromise) await loadingPromise;

  const appConfig = durableAppConfig(mod);
  const persistent = await requestPersistentStorage();
  setProgress({ text: await loadingMessage(mod, model, appConfig, persistent), progress: 0 });

  const created = new mod.MLCEngine({
    appConfig,
    initProgressCallback: (report: { text: string; progress: number }) => {
      setProgress({ text: report.text, progress: report.progress });
    },
  });
  engine = created;

  const onAbort = () => {
    void created.interruptGenerate();
  };
  signal.addEventListener('abort', onAbort, { once: true });

  loadingPromise = created
    .reload(model)
    .then(() => {
      loadedModel = model;
      setProgress(null);
    })
    .catch((err: unknown) => {
      engine = null;
      loadedModel = null;
      setProgress(null);
      if (signal.aborted) throw new ProviderError('aborted', 'Stopped.', { providerLabel: ENTRY.name });
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError(
        'unsupported',
        /out of memory|oom|vram/i.test(message)
          ? 'That model does not fit in this device\'s GPU memory. Try the smallest in-browser model instead.'
          : `The in-browser model could not start${message ? `: ${message.slice(0, 160)}` : '.'}`,
        { providerLabel: ENTRY.name },
      );
    })
    .finally(() => {
      signal.removeEventListener('abort', onAbort);
      loadingPromise = null;
    });

  await loadingPromise;
  return created;
}

export const browserProvider: ChatProvider = {
  id: 'browser',
  name: ENTRY.name,

  async listModels(): Promise<ModelInfo[]> {
    const known = await availableBrowserModels();
    return MODELS.filter((m) => m.provider === 'browser')
      .filter((m) => known.size === 0 || known.has(m.id))
      .map((m) => ({ id: m.id, label: m.label, contextWindow: m.contextWindow }));
  },

  async *stream(messages: ProviderMessage[], opts: StreamOptions, signal: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
    requireWebGpu();

    // Loading (and downloading) weights can take a while, so it runs while we
    // drain progress into status events the UI can show. The first message is
    // the only slow one: afterwards the weights are cached.
    let settled = false;
    const load = ensureEngine(opts.model, signal);
    void load.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    let lastText = '';
    while (!settled) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      if (signal.aborted) {
        await load.catch(() => {});
        throw new ProviderError('aborted', 'Stopped.', { providerLabel: ENTRY.name });
      }
      if (lastProgress && lastProgress.text !== lastText) {
        lastText = lastProgress.text;
        yield { type: 'status', text: lastProgress.text, progress: lastProgress.progress };
      }
    }

    const engineInstance = await load;
    if (signal.aborted) throw new ProviderError('aborted', 'Stopped.', { providerLabel: ENTRY.name });

    const payload = toChatCompletions(messages, opts.system);
    const onAbort = () => void engineInstance.interruptGenerate();
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const chunks = await engineInstance.chat.completions.create({
        stream: true,
        messages: payload,
        temperature: opts.temperature ?? 0.7,
        ...(opts.maxOutputTokens ? { max_tokens: opts.maxOutputTokens } : {}),
      });

      for await (const chunk of chunks) {
        if (signal.aborted) break;
        const text = chunk.choices?.[0]?.delta?.content;
        if (text) yield { type: 'delta', text };
        const usage = chunk.usage;
        if (usage) {
          yield { type: 'usage', inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
        }
      }
      yield { type: 'done' };
    } catch (err) {
      if (signal.aborted) throw new ProviderError('aborted', 'Stopped.', { providerLabel: ENTRY.name });
      const message = err instanceof Error ? err.message : String(err);
      throw new ProviderError('unknown', `The in-browser model stopped: ${message.slice(0, 160)}`, {
        providerLabel: ENTRY.name,
      });
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  },

  async test() {
    requireWebGpu();
    const known = await availableBrowserModels();
    if (!known.size) {
      throw new ProviderError('unsupported', 'The in-browser runtime is unavailable right now.', {
        providerLabel: ENTRY.name,
        retryable: false,
      });
    }
    return {
      detail:
        'WebGPU available. The first message downloads the model once; after that it loads from this device\'s IndexedDB cache.',
    };
  },
};

/** Frees GPU memory. Called when the user clears all data. */
export async function unloadBrowserModel(): Promise<void> {
  try {
    if (engine) await engine.unload();
  } catch {
    /* nothing to unload */
  }
  engine = null;
  loadedModel = null;
  setProgress(null);
}

/**
 * Removes downloaded weights from the browser cache, so "Clear all data" can
 * honestly promise to free the space. Both stores are cleared: the IndexedDB one
 * this build uses, and the Cache API store earlier builds downloaded into. Every
 * prebuilt ID is covered, not just the ones this registry lists, so weights left
 * behind by an older model list go too.
 */
export async function purgeBrowserModelCache(): Promise<void> {
  try {
    const mod = await loadModule();
    const durable = durableAppConfig(mod);
    const ids = new Set<string>([
      ...mod.prebuiltAppConfig.model_list.map((record) => record.model_id),
      ...MODELS.filter((m) => m.provider === 'browser').map((m) => m.id),
    ]);
    await Promise.all(
      [...ids].flatMap((id) => [
        mod.deleteModelAllInfoInCache(id, durable).catch(() => {}),
        mod.deleteModelAllInfoInCache(id).catch(() => {}),
      ]),
    );
  } catch {
    /* cache API unavailable or nothing cached */
  }
}
