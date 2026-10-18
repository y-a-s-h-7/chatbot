import { create } from 'zustand';
import { setCredentials } from '../lib/credentials';
import { applyTheme, readStoredTheme, type ThemeMode } from '../lib/theme';
import {
  forgetAllRememberedKeys,
  forgetRememberedKey,
  loadRememberedKeys,
  rememberKey,
  secureStorageLabel,
} from '../lib/native/secrets';
import { isNativeShell } from '../lib/native/platform';
import type { ProviderId } from '../providers/providers';
import { toastError } from './toastStore';

/**
 * Preferences live in localStorage. API keys do not: they are either kept in
 * memory for this session only, or handed to the platform secret store — the OS
 * credential store in the desktop app, the Android Keystore on Android, and
 * (honestly, because a browser has nothing better) localStorage on the web.
 *
 * The preferences blob deliberately has no key material in it. Older builds
 * wrote remembered keys into it, so `hydrate()` moves any it finds into the
 * secret store and rewrites the blob without them.
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
  /** providerId -> the user asked for this key to survive a restart. */
  remembered: Partial<Record<ProviderId, boolean>>;
  connected: Partial<Record<ProviderId, boolean>>;
  /** @deprecated written by builds before the secret store existed; read once. */
  rememberedKeys?: Partial<Record<ProviderId, string>>;
}

export interface SettingsState extends PersistedSettings {
  hydrated: boolean;
  /** True once remembered keys have been read from the platform secret store. */
  keysReady: boolean;
  /** In-memory keys for this session, including the remembered ones. */
  keys: Partial<Record<ProviderId, string>>;
  /** providerId -> is the key persisted on this device? */
  remember: Partial<Record<ProviderId, boolean>>;

  hydrate(): Promise<void>;
  setTheme(theme: ThemeMode): void;
  setModel(modelId: string, source?: 'user' | 'auto'): void;
  setTemperature(value: number): void;
  setSystemPrompt(value: string): void;
  setSidebarCollapsed(value: boolean): void;
  setAutoScroll(value: boolean): void;
  setBaseUrl(provider: ProviderId, value: string): void;
  setKey(provider: ProviderId, key: string, remember: boolean): Promise<void>;
  clearKey(provider: ProviderId): Promise<void>;
  setRemember(provider: ProviderId, remember: boolean): Promise<void>;
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
  remembered: {},
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
      remembered: parsed.remembered ?? {},
      connected: parsed.connected ?? {},
    };
  } catch {
    return fallback;
  }
}

/** Everything in the prefs blob except keys — which are never written here. */
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
    remembered: state.remember,
    connected: state.connected,
  };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(payload));
  } catch {
    /* storage blocked: preferences stay in memory, which is the safe fallback */
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => {
  /** Push the credentials adapters read from, so they never import this store. */
  const syncCredentials = () => {
    const state = get();
    setCredentials({
      keys: state.keys,
      connected: state.connected,
      customBaseUrl: state.customBaseUrl,
      ollamaBaseUrl: state.ollamaBaseUrl,
    });
  };

  const commit = (patch: Partial<SettingsState>) => {
    set(patch as SettingsState);
    persist(get());
    syncCredentials();
  };

  /**
   * Moves any keys that older builds left in the preferences blob into the
   * platform secret store, then merges whatever the store holds into memory.
   */
  async function loadKeys(legacy: Partial<Record<ProviderId, string>>): Promise<void> {
    let stored: Partial<Record<ProviderId, string>> = {};
    try {
      stored = await loadRememberedKeys();
    } catch {
      stored = {};
    }

    const recovered: Partial<Record<ProviderId, string>> = {};
    for (const [id, value] of Object.entries(legacy ?? {})) {
      if (!value) continue;
      const provider = id as ProviderId;
      if (stored[provider]) continue;
      if (await rememberKey(provider, value)) recovered[provider] = value;
    }

    const merged = { ...stored, ...recovered };
    const remember = { ...get().remember };
    for (const id of Object.keys(merged)) remember[id as ProviderId] = true;

    // A key pasted while this was loading wins, but it is not persisted until
    // the user says so.
    const keys = { ...merged, ...get().keys };
    set({ keys, remember, keysReady: true });
    persist(get());
    syncCredentials();
  }

  /** Writes a key to (or removes it from) the platform secret store. */
  async function persistKey(provider: ProviderId, key: string | null): Promise<boolean> {
    if (key === null) {
      await forgetRememberedKey(provider);
      return true;
    }
    return rememberKey(provider, key);
  }

  return {
    version: 1 as const,
    ...DEFAULTS,
    hydrated: false,
    keysReady: false,
    keys: {},
    remember: {},

    async hydrate() {
      if (get().hydrated) return;
      const persisted = readPersisted();
      const legacyKeys = persisted.rememberedKeys ?? {};
      delete persisted.rememberedKeys;

      set({
        ...persisted,
        keys: {},
        remember: { ...persisted.remembered },
        hydrated: true,
        theme: readStoredTheme(),
      });
      syncCredentials();
      applyTheme(get().theme);

      // Rewrite the blob immediately: the keys it used to carry are now either
      // in the secret store or in memory, and a failed read must not leave them
      // sitting in localStorage for another build to pick up.
      persist(get());
      await loadKeys(legacyKeys);
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

    async setKey(provider, key, remember) {
      const trimmed = key.trim();
      commit({
        keys: { ...get().keys, [provider]: trimmed },
        remember: { ...get().remember, [provider]: remember },
      });
      if (!remember) {
        await persistKey(provider, null);
        return;
      }
      const ok = await persistKey(provider, trimmed);
      if (ok) return;
      // Never claim a key is remembered when the platform store refused it.
      commit({ remember: { ...get().remember, [provider]: false } });
      toastError(
        'Not saved on this device',
        `This device would not give the app access to ${secureStorageLabel()}, so the key is only in memory for this session.`,
      );
    },

    async clearKey(provider) {
      const keys = { ...get().keys };
      const remember = { ...get().remember };
      const connected = { ...get().connected };
      delete keys[provider];
      delete remember[provider];
      delete connected[provider];
      commit({ keys, remember, connected });
      await persistKey(provider, null);
    },

    async setRemember(provider, remember) {
      commit({ remember: { ...get().remember, [provider]: remember } });
      const key = get().keys[provider];
      if (!remember) {
        await persistKey(provider, null);
        return;
      }
      if (!key) return;
      const ok = await persistKey(provider, key);
      if (!ok) {
        commit({ remember: { ...get().remember, [provider]: false } });
        toastError('Not saved on this device', `The app could not write to ${secureStorageLabel()}.`);
      }
    },

    setConnected(provider, connected) {
      commit({ connected: { ...get().connected, [provider]: connected } });
    },

    resetEverything() {
      const cleared = {
        version: 1 as const,
        ...DEFAULTS,
        keys: {},
        remember: {},
        connected: {},
        modelSource: 'default' as const,
      };
      commit(cleared as Partial<SettingsState>);
      try {
        localStorage.removeItem(PREFS_KEY);
      } catch {
        /* nothing to remove */
      }
      void forgetAllRememberedKeys();
      applyTheme('system');
    },
  };
});

/** Where a remembered key would be stored here — for Settings copy. */
export function keyStorageLabel(): string {
  return secureStorageLabel();
}

/** True when the app is running inside the desktop or Android shell. */
export function isDesktopOrMobileApp(): boolean {
  return isNativeShell();
}
