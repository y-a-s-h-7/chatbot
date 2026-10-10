/**
 * The only module the rest of the app imports to talk to models.
 * It maps a ProviderId onto a concrete adapter and answers the question the UI
 * actually asks: "can the user pick this model right now, and if not, why?"
 */

import { getCredentials, getKey } from '../lib/credentials';
import { anthropicProvider } from './anthropic';
import { geminiProvider } from './gemini';
import { createOpenAiCompatProvider } from './openai-compat';
import { MODELS, mergeWithDiscovered, type ModelEntry } from './models';
import { FREE_PROXY_PATH, PROVIDERS, type ProviderId } from './providers';
import { browserProvider, hasWebGpu } from './webllm';
import type { ChatProvider } from './types';

const cache = new Map<ProviderId, ChatProvider>();

export function getProvider(id: ProviderId): ChatProvider {
  const existing = cache.get(id);
  if (existing) return existing;

  let provider: ChatProvider;
  switch (id) {
    case 'gemini':
      provider = geminiProvider;
      break;
    case 'anthropic':
      provider = anthropicProvider;
      break;
    case 'browser':
      provider = browserProvider;
      break;
    case 'free-proxy':
      provider = createOpenAiCompatProvider({ id, baseUrl: FREE_PROXY_PATH, requiresKey: false });
      break;
    case 'openrouter':
      provider = createOpenAiCompatProvider({ id, attribution: true });
      break;
    case 'ollama':
    case 'custom':
      // Both are user-hosted: a key is optional and the base URL is theirs.
      provider = createOpenAiCompatProvider({ id, requiresKey: false });
      break;
    default:
      provider = createOpenAiCompatProvider({ id });
  }
  cache.set(id, provider);
  return provider;
}

// ---------------------------------------------------------------------------
// Free tier probe
// ---------------------------------------------------------------------------

export interface FreeProxyStatus {
  checked: boolean;
  /** The deployment has a server-side key and is willing to serve us. */
  configured: boolean;
  model?: string;
  label?: string;
  allowedModels?: string[];
  /** Why it is unavailable, phrased for humans. */
  reason?: string;
}

const FREE_PROXY_ENABLED = FREE_PROXY_PATH !== 'off' && FREE_PROXY_PATH !== 'none';

let freeProxyStatus: FreeProxyStatus = { checked: false, configured: false };
let freeProxyProbe: Promise<FreeProxyStatus> | null = null;
const freeProxyListeners = new Set<() => void>();

export function subscribeFreeProxy(listener: () => void): () => void {
  freeProxyListeners.add(listener);
  return () => freeProxyListeners.delete(listener);
}

export function getFreeProxyStatus(): FreeProxyStatus {
  return freeProxyStatus;
}

export async function probeFreeProxy(force = false): Promise<FreeProxyStatus> {
  if (!force && freeProxyStatus.checked) return freeProxyStatus;
  if (freeProxyProbe) return freeProxyProbe;

  // Static deployments can switch the probe off entirely, which keeps the
  // console clean when there is no serverless function behind /api/chat.
  if (!FREE_PROXY_ENABLED) {
    freeProxyStatus = {
      checked: true,
      configured: false,
      reason: 'The shared free tier is switched off for this build.',
    };
    for (const listener of freeProxyListeners) listener();
    return freeProxyStatus;
  }

  freeProxyProbe = (async () => {
    try {
      const res = await fetch(`${FREE_PROXY_PATH}/health`, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as {
        configured?: boolean;
        model?: string;
        label?: string;
        allowedModels?: string[];
      };
      freeProxyStatus = {
        checked: true,
        configured: Boolean(data.configured),
        model: data.model,
        label: data.label,
        allowedModels: data.allowedModels,
        reason: data.configured ? undefined : 'This deployment has no server key for the shared free tier.',
      };
    } catch {
      freeProxyStatus = {
        checked: true,
        configured: false,
        reason: 'No free-tier endpoint is reachable from this build.',
      };
    }
    freeProxyProbe = null;
    for (const listener of freeProxyListeners) listener();
    return freeProxyStatus;
  })();

  return freeProxyProbe;
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type AvailabilityStatus = 'ready' | 'needs-key' | 'connect' | 'unavailable';

/**
 * Providers that never need a credential, and providers that take any model ID
 * from a live list, still need an access mode for the picker's badge.
 */
export function accessModeForProvider(providerId: ProviderId): ModelEntry['accessMode'] {
  switch (providerId) {
    case 'browser':
    case 'free-proxy':
    case 'ollama':
    case 'custom':
      return 'free-default';
    case 'openrouter':
      return 'oauth';
    default:
      return 'needs-key';
  }
}

export interface Availability {
  status: AvailabilityStatus;
  /** Short badge text. */
  badge: string;
  /** Sentence explaining what happens when you pick it. */
  detail?: string;
}

/**
 * Honest UI: never advertise a capability the app cannot deliver right now.
 */
export function getAvailability(entry: ModelEntry): Availability {
  const provider = PROVIDERS[entry.provider];
  const credentials = getCredentials();

  if (entry.requires === 'webgpu' && !hasWebGpu()) {
    return {
      status: 'unavailable',
      badge: 'No WebGPU',
      detail: 'This browser cannot run local models. Chrome or Edge 113+ on desktop can.',
    };
  }

  if (entry.requires === 'free-proxy' && !freeProxyStatus.configured) {
    return {
      status: 'unavailable',
      badge: 'Not deployed',
      detail: freeProxyStatus.reason ?? 'The shared free tier is not configured on this deployment.',
    };
  }

  if (entry.provider === 'custom' && !credentials.customBaseUrl) {
    return {
      status: 'unavailable',
      badge: 'No URL',
      detail: 'Add the endpoint base URL in Settings → Providers first.',
    };
  }

  if (entry.accessMode === 'free-default') {
    const local = entry.provider === 'ollama' || entry.provider === 'custom';
    return {
      status: 'ready',
      badge: local ? 'Local' : 'Free',
      detail: local
        ? 'Runs on an endpoint you control. No key required.'
        : entry.provider === 'browser'
          ? 'Runs on this device. No key needed.'
          : 'Rate limited, but no key or login needed.',
    };
  }

  if (entry.accessMode === 'oauth') {
    if (credentials.connected[entry.provider]) {
      return { status: 'ready', badge: 'Connected', detail: `Signed in through ${provider.name}.` };
    }
    if (getKey(entry.provider)) {
      return { status: 'ready', badge: 'Key ready', detail: `Using the API key you saved for ${provider.name}.` };
    }
    return {
      status: 'connect',
      badge: 'Connect',
      detail: `${provider.name} supports one-click connect, or paste a key instead.`,
    };
  }

  if (getKey(entry.provider)) {
    return { status: 'ready', badge: 'Key ready', detail: `Using the API key you saved for ${provider.name}.` };
  }

  return {
    status: 'needs-key',
    badge: 'Key needed',
    detail: `${provider.name} needs an API key. It stays in this browser.`,
  };
}

/** The free-proxy model is whatever the deployment configured, so patch it in. */
export function applyRuntimeOverrides(entry: ModelEntry): ModelEntry {
  if (entry.provider !== 'free-proxy' || !freeProxyStatus.configured || !freeProxyStatus.model) return entry;
  return {
    ...entry,
    id: freeProxyStatus.model,
    label: 'Free — limited',
    notes: freeProxyStatus.label ?? entry.notes,
  };
}

/** Registry entries, plus whatever the provider reports live (best effort). */
export async function resolveModels(providerId: ProviderId, signal?: AbortSignal): Promise<ModelEntry[]> {
  const seeded = MODELS.filter((m) => m.provider === providerId && !m.retired).map(applyRuntimeOverrides);
  try {
    const discovered = await getProvider(providerId).listModels(signal);
    if (!discovered.length) return seeded;
    const accessMode = seeded[0]?.accessMode ?? 'needs-key';
    return mergeWithDiscovered(providerId, seeded, discovered, accessMode);
  } catch {
    // Discovery is a nicety. A missing key or an offline endpoint must not break
    // the picker, so we fall back to the curated registry.
    return seeded;
  }
}

/** Every curated entry, with runtime overrides applied. */
export function allCuratedModels(): ModelEntry[] {
  return MODELS.filter((m) => !m.retired).map(applyRuntimeOverrides);
}

export { hasWebGpu } from './webllm';
export { PROVIDERS, PROVIDER_ORDER, FREE_PROXY_PATH, providerLabel, isProviderId } from './providers';
export type { ProviderId, ProviderEntry, ProviderKind, ConnectState } from './providers';
export * from './models';
export type * from './types';
