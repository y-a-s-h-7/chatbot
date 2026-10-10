/**
 * Provider registry: where each provider lives, how you authenticate, and
 * whether the browser is allowed to call it directly.
 *
 * Editing this file is the only step needed to add a provider (then implement
 * its adapter and register it in `src/providers/index.ts`).
 */

export type ProviderId =
  | 'gemini'
  | 'anthropic'
  | 'openrouter'
  | 'groq'
  | 'mistral'
  | 'together'
  | 'ollama'
  | 'custom'
  | 'free-proxy'
  | 'browser';

export type ProviderKind = 'gemini' | 'anthropic' | 'openai-compatible' | 'browser';

export type ConnectState =
  | { supported: true; kind: 'openrouter-pkce' }
  | { supported: false; reason: string };

export interface ProviderEntry {
  id: ProviderId;
  name: string;
  kind: ProviderKind;
  /** Short line shown under the name in Settings. */
  blurb: string;
  /** Base URL for OpenAI-compatible kinds; may be resolved at runtime. */
  baseUrl?: string;
  /** Where the user creates a key. */
  keyUrl?: string;
  docsUrl: string;
  apiKeyPlaceholder?: string;
  /** True when the provider works without any credential. */
  keyless?: boolean;
  /** True when the base URL comes from user settings. */
  userBaseUrl?: boolean;
  /** Whether the browser can call the API directly (CORS). */
  corsSafe: boolean;
  /** Extra headers every request needs. */
  extraHeaders?: Record<string, string>;
  /** Honest answer to "can I just sign in?" */
  connect: ConnectState;
  note?: string;
}

export const PROVIDERS: Record<ProviderId, ProviderEntry> = {
  browser: {
    id: 'browser',
    name: 'This browser',
    kind: 'browser',
    blurb: 'Runs a small open model on your own GPU with WebGPU. Nothing is sent anywhere.',
    keyless: true,
    corsSafe: true,
    docsUrl: 'https://github.com/mlc-ai/web-llm',
    connect: {
      supported: false,
      reason: 'No account exists for a model running inside your own browser.',
    },
    note: 'First use downloads the weights once, then they are cached.',
  },

  'free-proxy': {
    id: 'free-proxy',
    name: 'Free tier (shared)',
    kind: 'openai-compatible',
    blurb: 'A rate-limited free model hosted by whoever deployed this app. No key, no login.',
    keyless: true,
    corsSafe: true,
    docsUrl: '/README.md#the-free-tier',
    connect: {
      supported: false,
      reason: 'The shared free tier is anonymous by design — there is no account to connect.',
    },
    note: 'Limited requests per minute, shared with everyone using this deployment.',
  },

  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    kind: 'gemini',
    blurb: 'Google AI Studio keys. Generous free tier, strong at long documents.',
    keyUrl: 'https://aistudio.google.com/apikey?utm_source=chatbot-app',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/api-key',
    apiKeyPlaceholder: 'AIza...',
    corsSafe: true,
    connect: {
      supported: false,
      reason:
        'Signing in with Google grants access to Google apps, not to the Generative Language API. Google requires an API key from AI Studio for browser and server use.',
    },
    note: 'Calls go straight from your browser to generativelanguage.googleapis.com.',
  },

  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    kind: 'anthropic',
    blurb: 'Claude Opus, Sonnet and Haiku. Uses the Messages API.',
    keyUrl: 'https://platform.claude.com/settings/keys?utm_source=chatbot-app',
    docsUrl: 'https://platform.claude.com/docs/en/api/messages',
    apiKeyPlaceholder: 'sk-ant-...',
    corsSafe: true,
    connect: {
      supported: false,
      reason:
        'A Claude Pro or Max subscription does not include Claude API access, so there is nothing to connect. Anthropic issues API keys separately in the Claude Console.',
    },
    note: 'Direct browser access is enabled by Anthropic for the Messages API.',
  },

  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    blurb: 'One key (or one click) for hundreds of models, including free ones.',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyUrl: 'https://openrouter.ai/settings/keys?utm_source=chatbot-app',
    docsUrl: 'https://openrouter.ai/docs/quickstart',
    apiKeyPlaceholder: 'sk-or-v1-...',
    corsSafe: true,
    connect: { supported: true, kind: 'openrouter-pkce' },
    note: 'Free models are capped per day. Connecting creates a key you can revoke any time.',
  },

  groq: {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    blurb: 'Very fast open-weight inference.',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyUrl: 'https://console.groq.com/keys?utm_source=chatbot-app',
    docsUrl: 'https://console.groq.com/docs/openai',
    apiKeyPlaceholder: 'gsk_...',
    corsSafe: true,
    connect: {
      supported: false,
      reason: 'Groq issues API keys from the console; there is no consumer sign-in that grants API access.',
    },
  },

  mistral: {
    id: 'mistral',
    name: 'Mistral',
    kind: 'openai-compatible',
    blurb: 'Mistral and Codestral models.',
    baseUrl: 'https://api.mistral.ai/v1',
    keyUrl: 'https://console.mistral.ai/api-keys?utm_source=chatbot-app',
    docsUrl: 'https://docs.mistral.ai/api/',
    apiKeyPlaceholder: '...',
    corsSafe: true,
    connect: {
      supported: false,
      reason: 'Mistral API access comes from a console API key, not from the Le Chat subscription.',
    },
  },

  together: {
    id: 'together',
    name: 'Together',
    kind: 'openai-compatible',
    blurb: 'Hosted open models, including a few free endpoints.',
    baseUrl: 'https://api.together.xyz/v1',
    keyUrl: 'https://api.together.ai/settings/api-keys?utm_source=chatbot-app',
    docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility',
    apiKeyPlaceholder: '...',
    corsSafe: true,
    connect: {
      supported: false,
      reason: 'Together authenticates with API keys created in its dashboard.',
    },
  },

  ollama: {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'openai-compatible',
    blurb: 'Models running on your own machine. No account, no key, no cloud.',
    baseUrl: 'http://localhost:11434/v1',
    docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
    keyless: true,
    corsSafe: true,
    connect: {
      supported: false,
      reason: 'Your local runtime is already yours — there is nothing to sign in to.',
    },
    note: 'Start Ollama with OLLAMA_ORIGINS set to this app\'s origin so it allows the call.',
  },

  custom: {
    id: 'custom',
    name: 'Custom (OpenAI-compatible)',
    kind: 'openai-compatible',
    blurb: 'Any endpoint that speaks the OpenAI chat-completions API.',
    userBaseUrl: true,
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat',
    apiKeyPlaceholder: 'optional, depends on your endpoint',
    corsSafe: false,
    connect: {
      supported: false,
      reason: 'A self-hosted or third-party endpoint issues its own credentials.',
    },
    note: 'Add its origin to connect-src in vite.config.ts, or route it through your own proxy.',
  },
};

/** Order shown in Settings and in the model picker. */
export const PROVIDER_ORDER: ProviderId[] = [
  'browser',
  'free-proxy',
  'gemini',
  'anthropic',
  'openrouter',
  'groq',
  'mistral',
  'together',
  'ollama',
  'custom',
];

/** Same-origin path used in dev; overridable for deployed builds. */
export const FREE_PROXY_PATH = import.meta.env.VITE_FREE_PROXY_URL || '/api/chat';

export function providerLabel(id: ProviderId): string {
  return PROVIDERS[id]?.name ?? id;
}

export function isProviderId(value: string): value is ProviderId {
  return Object.prototype.hasOwnProperty.call(PROVIDERS, value);
}
