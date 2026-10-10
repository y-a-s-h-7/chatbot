import { create } from 'zustand';
import { setCredentials } from '../lib/credentials';
import { applyTheme, readStoredTheme, type ThemeMode } from '../lib/theme';
import type { ProviderId } from '../providers/providers';

/**
 * Preferences persist to localStorage. API keys only persist when the user ticks
 * "Remember on this device" for that provider — otherwise they live in this
 * in-memory store and are gone the moment the tab closes.
 */

const PREFS_KEY = 'chatbot.settings.v1';

export interface PersistedSettings {
  version: 1;
  theme: ThemeMode;
  modelId: string;
  /** Whether the model is still our suggestion or the user's explicit choice. */
  modelSource: 'default' | 'user';
  temperature: number;
  systemPrompt: string;
  sidebarCollapsed: boolean;
  autoScroll: boolean;
  customBaseUrl: string;
  ollamaBaseUrl: string;
  /** providerId -> key, ONLY for providers the user chose to remember. */
  rememberedKeys: Partial<Record<ProviderId, string>>;
  connected: Partial<Record<ProviderId, boolean>>;
}

export interface SettingsState extends PersistedSettings {
  hydrated: boolean;
  /** In-memory keys, including the remembered ones. */
  keys: Partial<Record<ProviderId, string>>;
  /** providerId -> is the key persisted? */
  remember: Partial<Record<ProviderId, boolean>>;

  hydrate(): void;
  setTheme(theme: ThemeMode): void;
  setModel(modelId: string, source?: 'user' | 'auto'): void;
  setTemperature(value: number): void;
  setSystemPrompt(value: string): void;
  setSidebarCollapsed(value: boolean): void;
  setAutoScroll(value: boolean): void;
  setBaseUrl(provider: ProviderId, value: string): void;
  setKey(provider: ProviderId, key: string, remember: boolean): void;
  clearKey(provider: ProviderId): void;
  setRemember(provider: ProviderId, remember: boolean): void;
  setConnected(provider: ProviderId, connected: boolean): void;
  resetEverything(): void;
}

const DEFAULTS = {
  theme: 'system' as ThemeMode,
  // Starts on the shared free tier, then settles on whatever is actually
  // reachable (local model, a connected account, or a key-needing default).
  modelId: 'free',
  modelSource: 'default' as const,
  temperature: 0.7,
  systemPrompt: '',
  sidebarCollapsed: false,
  autoScroll: true,
  customBaseUrl: '',
  ollamaBaseUrl: '',
  rememberedKeys: {},
  connected: {},
};

/** The in-browser model, used when there is no shared free tier behind us. */
export const BROWSER_FALLBACK_MODEL = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';

export const DEFAULT_MODEL_ID = DEFAULTS.modelId;

function readPersisted(): PersistedSettings {
  const fallback: PersistedSettings = { version: 1, ...DEFAULTS };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<PersistedSettings>;
    if (parsed.version !== 1) return fallback;
    return {
      ...fallback,
      ...parsed,
      rememberedKeys: parsed.rememberedKeys ?? {},
      connected: parsed.connected ?? {},
    };
  } catch {
    return fallback;
  }
}

function persist(state: SettingsState): void {
  const payload: PersistedSettings = {
    version: 1,
    theme: state.theme,
    modelId: state.modelId,
    modelSource: state.modelSource,
    temperature: state.temperature,
    systemPrompt: state.systemPrompt,
    sidebarCollapsed: state.sidebarCollapsed,
    autoScroll: state.autoScroll,
    customBaseUrl: state.customBaseUrl,
    ollamaBaseUrl: state.ollamaBaseUrl,
    rememberedKeys: Object.fromEntries(
      Object.entries(state.keys).filter(([id]) => state.remember[id as ProviderId]),
    ) as Partial<Record<ProviderId, string>>,
    connected: state.connected,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {
    /* storage blocked: keys stay in memory only, which is the safe fallback */
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  const commit = (patch: Partial<SettingsState>) => {
    set(patch as SettingsState);
    const state = get();
    persist(state);
    setCredentials({
      keys: state.keys,
      connected: state.connected,
      customBaseUrl: state.customBaseUrl,
      ollamaBaseUrl: state.ollamaBaseUrl,
    });
  };

  return {
    version: 1 as const,
    ...DEFAULTS,
    hydrated: false,
    keys: {},
    remember: {},

    hydrate() {
      if (get().hydrated) return;
      const persisted = readPersisted();
      const keys = { ...(persisted.rememberedKeys ?? {}) };
      const remember: Partial<Record<ProviderId, boolean>> = {};
      for (const id of Object.keys(keys)) remember[id as ProviderId] = true;
      set({
        ...persisted,
        keys,
        remember,
        hydrated: true,
        theme: readStoredTheme(),
      });
      const state = get();
      setCredentials({
        keys: state.keys,
        connected: state.connected,
        customBaseUrl: state.customBaseUrl,
        ollamaBaseUrl: state.ollamaBaseUrl,
      });
      applyTheme(state.theme);
    },

    setTheme(theme) {
      applyTheme(theme);
      commit({ theme });
    },

    setModel(modelId, source = 'user') {
      commit({ modelId, modelSource: source === 'user' ? 'user' : 'default' });
    },

    setTemperature(value) {
      commit({ temperature: Math.min(Math.max(value, 0), 1.5) });
    },

    setSystemPrompt(systemPrompt) {
      commit({ systemPrompt });
    },

    setSidebarCollapsed(sidebarCollapsed) {
      commit({ sidebarCollapsed });
    },

    setAutoScroll(autoScroll) {
      commit({ autoScroll });
    },

    setBaseUrl(provider, value) {
      const clean = value.trim();
      if (provider === 'custom') commit({ customBaseUrl: clean });
      else if (provider === 'ollama') commit({ ollamaBaseUrl: clean });
    },

    setKey(provider, key, remember) {
      commit({
        keys: { ...get().keys, [provider]: key.trim() },
        remember: { ...get().remember, [provider]: remember },
      });
    },

    clearKey(provider) {
      const keys = { ...get().keys };
      const remember = { ...get().remember };
      const connected = { ...get().connected };
      delete keys[provider];
      delete remember[provider];
      delete connected[provider];
      commit({ keys, remember, connected });
    },

    setRemember(provider, remember) {
      commit({ remember: { ...get().remember, [provider]: remember } });
    },

    setConnected(provider, connected) {
      commit({ connected: { ...get().connected, [provider]: connected } });
    },

    resetEverything() {
      const cleared = { version: 1 as const, ...DEFAULTS, keys: {}, remember: {}, connected: {}, modelSource: 'default' as const };
      commit(cleared as Partial<SettingsState>);
      try {
        localStorage.removeItem(PREFS_KEY);
      } catch {
        /* nothing to remove */
      }
      applyTheme('system');
    },
  };
});
