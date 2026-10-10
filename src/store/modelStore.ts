import { create } from 'zustand';
import {
  MODELS,
  accessModeForProvider,
  allCuratedModels,
  applyRuntimeOverrides,
  getAvailability,
  getFreeProxyStatus,
  getProvider,
  isProviderId,
  parseModelKey,
  probeFreeProxy,
  subscribeFreeProxy,
  type FreeProxyStatus,
  type ModelEntry,
} from '../providers';
import type { ProviderId } from '../providers/providers';
import { getCredentials } from '../lib/credentials';

/**
 * The catalog the picker renders: curated registry entries first, then whatever
 * a provider reports from its own /models endpoint once we have a credential.
 */

interface ModelState {
  models: ModelEntry[];
  freeProxy: FreeProxyStatus;
  /** Providers whose live list we pulled successfully this session. */
  discovered: ProviderId[];
  discovering: ProviderId[];
  /** providerId -> when a failed attempt happened, so we retry after a pause. */
  failed: Partial<Record<ProviderId, number>>;
  bootstrapped: boolean;

  bootstrap(): Promise<void>;
  refreshFreeProxy(force?: boolean): Promise<void>;
  discover(providerId: ProviderId, options?: { force?: boolean }): Promise<void>;
  byId(id: string): ModelEntry | undefined;
  /** The model we pick when nothing is saved, or the saved one has gone away. */
  bestDefaultModel(): ModelEntry | undefined;
}

/** How long to wait before retrying a provider that failed to answer. */
const DISCOVERY_RETRY_MS = 15_000;

function initialFreeProxy(): FreeProxyStatus {
  return typeof window === 'undefined' ? { checked: false, configured: false } : getFreeProxyStatus();
}

/**
 * Providers whose live model list we have fetched successfully before. Used to
 * avoid probing endpoints that are not there (a request to a stopped local
 * runtime is a console error the app cannot suppress).
 */
const KNOWN_PROVIDERS_KEY = 'chatbot.knownProviders';

function readKnownProviders(): ProviderId[] {
  try {
    const raw = localStorage.getItem(KNOWN_PROVIDERS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((id) => typeof id === 'string') as ProviderId[]) : [];
  } catch {
    return [];
  }
}

function rememberKnownProvider(providerId: ProviderId): void {
  const known = readKnownProviders();
  if (known.includes(providerId)) return;
  try {
    localStorage.setItem(KNOWN_PROVIDERS_KEY, JSON.stringify([...known, providerId]));
  } catch {
    /* storage blocked: we simply probe again next time */
  }
}

export const useModelStore = create<ModelState>((set, get) => ({
  models: allCuratedModels(),
  freeProxy: initialFreeProxy(),
  discovered: [],
  discovering: [],
  failed: {},
  bootstrapped: false,

  async bootstrap() {
    if (get().bootstrapped) return;
    set({ bootstrapped: true });
    // Keep the catalog in sync whenever the free-tier probe resolves.
    subscribeFreeProxy(() => {
      set({ freeProxy: getFreeProxyStatus(), models: allCuratedModels() });
    });
    await get().refreshFreeProxy();

    // Pull live model lists for the providers we can already talk to, so the
    // picker is populated before it opens and a saved model ID still resolves.
    // We do not probe endpoints the user has never used: a request to a local
    // runtime that is not running shows up as a console error we cannot suppress.
    const credentials = getCredentials();
    const known = readKnownProviders();
    const candidates: ProviderId[] = ['ollama', 'custom', 'gemini', 'anthropic', 'openrouter', 'groq', 'mistral', 'together'];
    await Promise.all(
      candidates
        .filter((id) => {
          // Local and self-hosted endpoints are only probed once we have evidence
          // they exist: a base URL, or a model we successfully used from them.
          if (id === 'ollama') return Boolean(credentials.ollamaBaseUrl) || known.includes('ollama');
          if (id === 'custom') return Boolean(credentials.customBaseUrl);
          return Boolean(credentials.keys[id]) || Boolean(credentials.connected[id]);
        })
        .map((id) => get().discover(id)),
    );
  },

  async refreshFreeProxy(force = false) {
    const status = await probeFreeProxy(force);
    set({ freeProxy: status, models: allCuratedModels() });
  },

  async discover(providerId, options) {
    const { discovered, discovering, failed } = get();
    if (discovering.includes(providerId)) return;
    // A provider that already answered successfully has nothing to prove again.
    if (discovered.includes(providerId) && !options?.force) return;
    // A failure must not be terminal: keys and base URLs get filled in later, and
    // an endpoint can simply be down for a moment. Retry, but not in a hot loop.
    const failedAt = failed[providerId];
    if (!options?.force && failedAt && Date.now() - failedAt < DISCOVERY_RETRY_MS) return;

    set({ discovering: [...discovering, providerId] });
    try {
      const live = await getProvider(providerId).listModels();
      if (live.length) {
        rememberKnownProvider(providerId);
        const seeded = get().models.filter((m) => m.provider === providerId);
        const accessMode = accessModeForProvider(providerId);
        const seen = new Set(seeded.map((m) => m.id));
        const extras: ModelEntry[] = live
          .filter((m) => !seen.has(m.id))
          .map((m) => ({
            id: m.id,
            provider: providerId,
            label: m.label ?? m.id,
            accessMode,
            contextWindow: m.contextWindow ?? 0,
            notes: 'Discovered live from the provider.',
          }));
        set({ models: [...get().models.filter((m) => m.provider !== providerId), ...seeded, ...extras] });
      }
      const ok = live.length > 0;
      set({
        discovering: get().discovering.filter((id) => id !== providerId),
        discovered: ok ? [...new Set([...get().discovered, providerId])] : get().discovered,
        failed: ok ? { ...get().failed, [providerId]: undefined } : { ...get().failed, [providerId]: Date.now() },
      });
    } catch {
      // Discovery is optional: no key, no network, or a CORS hiccup must not
      // break the picker. It is retried later, so filling in a key or a base URL
      // starts working without a page reload.
      set({
        discovering: get().discovering.filter((id) => id !== providerId),
        failed: { ...get().failed, [providerId]: Date.now() },
      });
    }
  },

  byId(key) {
    const models = get().models;
    // Preferred form: "provider:model-id", which is unambiguous.
    const scoped = parseModelKey(key, isProviderId);
    if (scoped) {
      const exact = models.find((m) => m.provider === scoped.provider && m.id === scoped.id);
      if (exact) return applyRuntimeOverrides(exact);
    }
    // Legacy bare IDs (saved before keys were provider-scoped) still resolve.
    const found = models.find((m) => m.id === key);
    if (found) return applyRuntimeOverrides(found);
    // The shared free tier renames its model server-side; match by provider.
    if (get().freeProxy.configured && get().freeProxy.model === key) {
      const placeholder = models.find((m) => m.provider === 'free-proxy');
      if (placeholder) return applyRuntimeOverrides(placeholder);
    }
    return undefined;
  },

  bestDefaultModel() {
    const models = get().models;
    const ready = models.filter((model) => getAvailability(model).status === 'ready');
    return (
      ready.find((model) => model.recommended && model.accessMode === 'free-default') ??
      ready.find((model) => model.accessMode === 'free-default') ??
      ready.find((model) => model.recommended) ??
      ready[0] ??
      models.find((model) => model.recommended && model.accessMode === 'needs-key')
    );
  },
}));

/** Curated entries grouped for the Settings screen. */
export function curatedForProvider(providerId: ProviderId): ModelEntry[] {
  return MODELS.filter((m) => m.provider === providerId && !m.retired);
}
