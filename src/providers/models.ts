/**
 * MODEL REGISTRY — the one file you edit when free tiers change.
 *
 * No model ID lives in UI code. Everything the picker shows comes from here,
 * merged with whatever a provider reports live from its own /models endpoint.
 *
 * Verified against provider documentation on 2026-10-10:
 *  - Gemini:    https://ai.google.dev/gemini-api/docs/models
 *  - Anthropic: https://platform.claude.com/docs/en/models/overview
 *  - OpenRouter:https://openrouter.ai/collections/free-models
 * Providers retire IDs without notice — if a model 404s, delete or fix its row.
 *
 * To add a model: append an entry. To hide one: set `retired: true`.
 */

import type { ProviderId } from './providers';

export type AccessMode = 'free-default' | 'needs-key' | 'oauth';

export type ModelTag = 'fast' | 'balanced' | 'reasoning' | 'code' | 'vision' | 'long-context' | 'local' | 'free';

export interface ModelEntry {
  /** Exact identifier sent to the provider's API. */
  id: string;
  provider: ProviderId;
  /** Human label. Keep it short — the picker is narrow. */
  label: string;
  accessMode: AccessMode;
  contextWindow: number;
  maxOutput?: number;
  tags?: ModelTag[];
  notes?: string;
  /**
   * In-browser models only: the one-time download of the quantized weights, in
   * MB, and the GPU memory the runtime needs while it runs. Both are taken from
   * WebLLM's own model records and the published weight files, so the picker can
   * say what a model costs before the user commits to it. Rounded for display.
   */
  downloadMB?: number;
  memoryMB?: number;
  /** Runtime capability gate. The picker greys the model out if unmet. */
  requires?: 'webgpu' | 'free-proxy';
  /** For provider: 'custom' only. */
  baseUrl?: string;
  recommended?: boolean;
  retired?: boolean;
}

export const MODELS: ModelEntry[] = [
  // ---------------------------------------------------------------------------
  // This browser (WebLLM) — zero setup, nothing leaves the device.
  // Every ID below exists in the installed WebLLM's prebuilt list; the picker
  // hides any that does not. Weights download once and are then cached.
  // Sorted smallest first, so the list doubles as a "what will my machine run"
  // ladder: `downloadMB` is the one-time download, `memoryMB` the GPU memory the
  // runtime needs. Both are shown in the picker.
  // ---------------------------------------------------------------------------
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    provider: 'browser',
    label: 'SmolLM2 360M (in-browser)',
    accessMode: 'free-default',
    contextWindow: 4096,
    maxOutput: 1024,
    tags: ['free', 'local', 'fast'],
    requires: 'webgpu',
    downloadMB: 207,
    memoryMB: 376,
    notes:
      'The lightest option: ~210 MB download and ~380 MB of GPU memory. Fine for short, simple answers; it struggles with reasoning. Needs the shader-f16 WebGPU feature.',
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    provider: 'browser',
    label: 'Qwen2.5 0.5B (in-browser)',
    accessMode: 'free-default',
    contextWindow: 4096,
    maxOutput: 1024,
    tags: ['free', 'local', 'fast'],
    requires: 'webgpu',
    downloadMB: 290,
    memoryMB: 945,
    notes:
      '~290 MB download but ~950 MB of GPU memory, because this family reserves a large context window by default. Punches above its weight at short tasks.',
  },
  {
    id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    provider: 'browser',
    label: 'Llama 3.2 1B (in-browser)',
    accessMode: 'free-default',
    contextWindow: 4096,
    maxOutput: 2048,
    tags: ['free', 'local', 'fast'],
    requires: 'webgpu',
    recommended: true,
    downloadMB: 705,
    memoryMB: 879,
    notes: 'Needs WebGPU and a one-time ~710 MB download. Best all-round balance for short answers.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    provider: 'browser',
    label: 'Qwen2.5 1.5B (in-browser)',
    accessMode: 'free-default',
    contextWindow: 4096,
    maxOutput: 2048,
    tags: ['free', 'local'],
    requires: 'webgpu',
    downloadMB: 880,
    memoryMB: 1630,
    notes: 'One-time ~880 MB download, ~1.6 GB of GPU memory. Slightly better writing than Llama 1B.',
  },
  {
    id: 'SmolLM2-1.7B-Instruct-q4f16_1-MLC',
    provider: 'browser',
    label: 'SmolLM2 1.7B (in-browser)',
    accessMode: 'free-default',
    contextWindow: 4096,
    maxOutput: 2048,
    tags: ['free', 'local'],
    requires: 'webgpu',
    downloadMB: 966,
    memoryMB: 1774,
    notes:
      '~970 MB download, ~1.8 GB of GPU memory. Follows instructions well for its size. Needs the shader-f16 WebGPU feature.',
  },
  {
    id: 'gemma-2-2b-it-q4f16_1-MLC',
    provider: 'browser',
    label: 'Gemma 2 2B (in-browser)',
    accessMode: 'free-default',
    contextWindow: 4096,
    maxOutput: 2048,
    tags: ['free', 'local'],
    requires: 'webgpu',
    downloadMB: 1493,
    memoryMB: 1895,
    notes:
      '~1.5 GB download, ~1.9 GB of GPU memory. The strongest writer in this group. Needs the shader-f16 WebGPU feature.',
  },
  {
    id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    provider: 'browser',
    label: 'Llama 3.2 3B (in-browser)',
    accessMode: 'free-default',
    contextWindow: 4096,
    maxOutput: 2048,
    tags: ['free', 'local'],
    requires: 'webgpu',
    downloadMB: 1817,
    memoryMB: 2264,
    notes: 'One-time ~1.8 GB download, ~2.3 GB of GPU memory. Noticeably slower on integrated GPUs.',
  },

  // ---------------------------------------------------------------------------
  // Free tier (shared) — hosted by this deployment, rate limited, no key.
  // The concrete upstream model is whatever the server is configured with; the
  // picker replaces this placeholder with the live /api/chat/health answer.
  // ---------------------------------------------------------------------------
  {
    id: 'free',
    provider: 'free-proxy',
    label: 'Free — limited',
    accessMode: 'free-default',
    contextWindow: 262144,
    maxOutput: 2048,
    tags: ['free'],
    requires: 'free-proxy',
    notes: 'Shared with everyone on this deployment, so there is a per-minute cap.',
  },

  // ---------------------------------------------------------------------------
  // Google Gemini — needs a key from AI Studio.
  // ---------------------------------------------------------------------------
  {
    id: 'gemini-3.8-flash',
    provider: 'gemini',
    label: 'Gemini 3.8 Flash',
    accessMode: 'needs-key',
    contextWindow: 1048576,
    maxOutput: 65536,
    tags: ['balanced', 'vision', 'long-context'],
    recommended: true,
    notes: 'Current flagship Flash. Good default for everyday chat.',
  },
  {
    id: 'gemini-3.6-flash',
    provider: 'gemini',
    label: 'Gemini 3.6 Flash',
    accessMode: 'needs-key',
    contextWindow: 1048576,
    maxOutput: 65536,
    tags: ['balanced', 'vision'],
    notes: 'Previous generation Flash.',
  },
  {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.5 Flash-Lite',
    accessMode: 'needs-key',
    contextWindow: 1048576,
    maxOutput: 65536,
    tags: ['fast', 'vision'],
    notes: 'Cheapest and fastest 3.5 model. Google suggests it for new projects.',
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash-Lite',
    accessMode: 'needs-key',
    contextWindow: 1048576,
    tags: ['fast'],
  },
  {
    id: 'gemini-3.1-pro-preview',
    provider: 'gemini',
    label: 'Gemini 3.1 Pro (preview)',
    accessMode: 'needs-key',
    contextWindow: 1048576,
    maxOutput: 65536,
    tags: ['reasoning', 'vision', 'long-context'],
    notes: 'Preview model: rate limits are tighter and it can change or disappear.',
  },
  {
    id: 'gemini-3-flash-preview',
    provider: 'gemini',
    label: 'Gemini 3 Flash (preview)',
    accessMode: 'needs-key',
    contextWindow: 1048576,
    tags: ['fast', 'vision'],
    notes: 'Preview model.',
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash',
    accessMode: 'needs-key',
    contextWindow: 1048576,
    maxOutput: 65536,
    tags: ['fast', 'vision'],
    notes: 'Google now limits 2.5 models to projects that already used them.',
  },

  // ---------------------------------------------------------------------------
  // Anthropic Claude — needs a key from the Claude Console.
  // 4.6-generation-and-later IDs are dateless and pinned (no date suffix).
  // ---------------------------------------------------------------------------
  {
    id: 'claude-sonnet-5-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5.5',
    accessMode: 'needs-key',
    contextWindow: 1000000,
    maxOutput: 128000,
    tags: ['balanced', 'code', 'long-context'],
    recommended: true,
    notes: 'Anthropic calls this the best speed/intelligence combination.',
  },
  {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    label: 'Claude Haiku 5.5',
    accessMode: 'needs-key',
    contextWindow: 1000000,
    maxOutput: 128000,
    tags: ['fast', 'long-context'],
    notes: 'Fastest and cheapest current Claude. Great for rewriting and extraction.',
  },
  {
    id: 'claude-opus-5-5',
    provider: 'anthropic',
    label: 'Claude Opus 5.5',
    accessMode: 'needs-key',
    contextWindow: 1000000,
    maxOutput: 128000,
    tags: ['reasoning', 'code', 'long-context'],
    notes: 'Anthropic recommends Opus 5.5 as the default for most workloads.',
  },
  {
    id: 'claude-fable-5-1',
    provider: 'anthropic',
    label: 'Claude Fable 5.1',
    accessMode: 'needs-key',
    contextWindow: 1000000,
    maxOutput: 128000,
    tags: ['reasoning', 'long-context'],
    notes: 'For demanding reasoning and long-horizon work. Priciest option.',
  },
  {
    id: 'claude-sonnet-5',
    provider: 'anthropic',
    label: 'Claude Sonnet 5',
    accessMode: 'needs-key',
    contextWindow: 1000000,
    maxOutput: 128000,
    tags: ['balanced', 'code'],
    notes: 'Previous major version. Still available, cheaper than 5.5.',
  },
  {
    id: 'claude-opus-5',
    provider: 'anthropic',
    label: 'Claude Opus 5',
    accessMode: 'needs-key',
    contextWindow: 1000000,
    maxOutput: 128000,
    tags: ['reasoning'],
  },
  {
    id: 'claude-haiku-5',
    provider: 'anthropic',
    label: 'Claude Haiku 5',
    accessMode: 'needs-key',
    contextWindow: 1000000,
    maxOutput: 128000,
    tags: ['fast'],
  },

  // ---------------------------------------------------------------------------
  // OpenRouter — one credential covers hundreds of models, including these
  // zero-cost ones. Free tier: 20 requests/minute, 50/day under $10 lifetime
  // credit, 1000/day once you have bought $10.
  // ---------------------------------------------------------------------------
  {
    id: 'nvidia/nemotron-3.5-lightning:free',
    provider: 'openrouter',
    label: 'Nemotron 3.5 Lightning (free)',
    accessMode: 'oauth',
    contextWindow: 1000000,
    tags: ['free', 'balanced', 'long-context'],
    recommended: true,
    notes: 'Million-token context at zero cost. Can be busy at peak times.',
  },
  {
    id: 'google/gemma-4-31b-it:free',
    provider: 'openrouter',
    label: 'Gemma 4 31B (free)',
    accessMode: 'oauth',
    contextWindow: 262144,
    tags: ['free', 'vision'],
    notes: 'Handles text, images and video input. Strong everyday writer.',
  },
  {
    id: 'qwen/qwen3.8-27b:free',
    provider: 'openrouter',
    label: 'Qwen3.8 27B (free)',
    accessMode: 'oauth',
    contextWindow: 262144,
    tags: ['free', 'vision', 'code'],
  },
  {
    id: 'cohere/north-mini-code:free',
    provider: 'openrouter',
    label: 'North Mini Code (free)',
    accessMode: 'oauth',
    contextWindow: 256000,
    tags: ['free', 'code'],
  },
  {
    id: 'poolside/laguna-s-2.1:free',
    provider: 'openrouter',
    label: 'Laguna S 2.1 (free)',
    accessMode: 'oauth',
    contextWindow: 262144,
    tags: ['free', 'code'],
  },
  {
    id: 'thinkingmachines/inkling:free',
    provider: 'openrouter',
    label: 'Inkling (free)',
    accessMode: 'oauth',
    contextWindow: 1048576,
    tags: ['free', 'long-context'],
    notes: 'Audio and image input too. Good for very long documents.',
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    provider: 'openrouter',
    label: 'Nemotron 3 Ultra 550B (free)',
    accessMode: 'oauth',
    contextWindow: 1000000,
    tags: ['free', 'reasoning', 'long-context'],
  },
  {
    id: 'liquid/lfm-2.5-2.6b:free',
    provider: 'openrouter',
    label: 'LFM 2.5 2.6B (free)',
    accessMode: 'oauth',
    contextWindow: 65536,
    tags: ['free', 'fast'],
  },
  {
    id: 'openrouter/free',
    provider: 'openrouter',
    label: 'Auto (free router)',
    accessMode: 'oauth',
    contextWindow: 262144,
    tags: ['free'],
    notes: 'OpenRouter picks a random free model for each request. Quality varies.',
  },

  // ---------------------------------------------------------------------------
  // Local OpenAI-compatible runtimes and self-hosted endpoints: their model
  // lists are discovered live from the endpoint once a base URL is set, so
  // nothing is hardcoded here.
  // ---------------------------------------------------------------------------
];

/**
 * Model IDs are only unique within a provider: `llama-3.3-70b` or `gpt-oss-120b`
 * can be offered by Groq, Together, OpenRouter and a local runtime at once. The
 * app therefore selects models by this composite key, and resolves it back to
 * exactly one provider — otherwise picking a model could send the wrong key to
 * the wrong endpoint.
 */
export function modelKey(entry: Pick<ModelEntry, 'provider' | 'id'>): string {
  return `${entry.provider}:${entry.id}`;
}

/** Splits a composite key. Returns null for legacy bare IDs. */
export function parseModelKey(key: string, isProvider: (value: string) => boolean): { provider: ProviderId; id: string } | null {
  const separator = key.indexOf(':');
  if (separator <= 0) return null;
  const provider = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (!id || !isProvider(provider)) return null;
  return { provider: provider as ProviderId, id };
}

/** Curated first, then live-discovered models the registry does not know about. */
export function mergeWithDiscovered(
  provider: ProviderId,
  seeded: ModelEntry[],
  discovered: { id: string; label?: string; contextWindow?: number }[],
  accessMode: AccessMode = 'needs-key',
): ModelEntry[] {
  const seen = new Set(seeded.map((m) => m.id));
  const extras: ModelEntry[] = discovered
    .filter((m) => !seen.has(m.id))
    .map((m) => ({
      id: m.id,
      provider,
      label: m.label || m.id,
      accessMode,
      contextWindow: m.contextWindow ?? 0,
      notes: 'Discovered live from the provider.',
    }));
  return [...seeded, ...extras];
}


