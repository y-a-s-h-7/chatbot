import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * The security-relevant half of the settings store: API keys must never be
 * written into `chatbot.settings.v1`, they must be readable back from wherever
 * the shell keeps secrets, and "Clear all data" has to take them with it.
 *
 * This runs without a DOM, so the three browser globals the store touches are
 * stubbed. That is deliberate: it keeps the test fast and makes it obvious
 * exactly what the store depends on.
 */

const PREFS_KEY = 'chatbot.settings.v1';
const SECRET_KEY = 'chatbot.secret.provider-keys';

class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

interface StoreShape {
  useSettingsStore: {
    getState(): {
      hydrate(): Promise<void>;
      setKey(provider: string, key: string, remember: boolean): Promise<void>;
      clearKey(provider: string): Promise<void>;
      resetEverything(): void;
      keys: Record<string, string | undefined>;
      remember: Record<string, boolean | undefined>;
    };
    setState(partial: Record<string, unknown>): void;
  };
}

let store: StoreShape['useSettingsStore'];
let storage: MemoryStorage;

const legacyPrefs = (rememberedKeys: Record<string, string>) =>
  JSON.stringify({
    version: 1,
    theme: 'dark',
    modelId: 'free',
    modelSource: 'default',
    temperature: 0.7,
    systemPrompt: '',
    sidebarCollapsed: false,
    autoScroll: true,
    customBaseUrl: '',
    ollamaBaseUrl: '',
    rememberedKeys,
    connected: {},
  });

beforeAll(async () => {
  storage = new MemoryStorage();
  const globals = globalThis as unknown as Record<string, unknown>;
  globals.localStorage = storage;
  globals.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  globals.document = {
    documentElement: { classList: { toggle() {}, add() {}, remove() {} }, style: {} },
  };
  const module = (await import('../src/store/settingsStore')) as unknown as StoreShape;
  store = module.useSettingsStore;
});

beforeEach(() => {
  storage.clear();
  store.setState({ hydrated: false, keysReady: false, keys: {}, remember: {} });
});

describe('settings store key handling', () => {
  it('moves keys out of the preferences blob on first hydrate', async () => {
    storage.setItem(PREFS_KEY, legacyPrefs({ groq: 'gsk_legacy_value_123456' }));
    await store.getState().hydrate();

    const state = store.getState();
    expect(state.keys.groq).toBe('gsk_legacy_value_123456');
    expect(state.remember.groq).toBe(true);
    expect(storage.getItem(SECRET_KEY)).toContain('gsk_legacy_value_123456');

    const prefs = storage.getItem(PREFS_KEY) as string;
    expect(prefs).not.toContain('gsk_legacy');
    expect(prefs).not.toContain('rememberedKeys');
    expect(JSON.parse(prefs).remembered).toEqual({ groq: true });
  });

  it('writes a remembered key only to the secret store, never to the blob', async () => {
    await store.getState().hydrate();
    await store.getState().setKey('gemini', 'AIza_test_key_value', true);

    expect(storage.getItem(SECRET_KEY)).toContain('AIza_test_key_value');
    expect(storage.getItem(PREFS_KEY)).not.toContain('AIza_test_key_value');
  });

  it('keeps an unremembered key in memory and off the disk entirely', async () => {
    await store.getState().hydrate();
    await store.getState().setKey('gemini', 'AIza_memory_only', false);

    expect(store.getState().keys.gemini).toBe('AIza_memory_only');
    expect(storage.getItem(SECRET_KEY)).toBeNull();
    expect(storage.getItem(PREFS_KEY)).not.toContain('AIza_memory_only');
  });

  it('removes the stored copy when the user untickes remember', async () => {
    await store.getState().hydrate();
    await store.getState().setKey('openrouter', 'sk-or-test', true);
    expect(storage.getItem(SECRET_KEY)).toContain('sk-or-test');

    await store.getState().setKey('openrouter', 'sk-or-test', false);
    // Gone from disk, still usable this session.
    expect(storage.getItem(SECRET_KEY)).toBeNull();
    expect(store.getState().keys.openrouter).toBe('sk-or-test');
  });

  it('forgets stored keys on a full data clear', async () => {
    await store.getState().hydrate();
    await store.getState().setKey('mistral', 'mistral_test_value', true);
    expect(storage.getItem(SECRET_KEY)).not.toBeNull();

    store.getState().resetEverything();
    // The removal is async; give it a turn of the event loop.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(storage.getItem(SECRET_KEY)).toBeNull();
    expect(store.getState().keys).toEqual({});
    expect(storage.getItem(PREFS_KEY)).toBeNull();
  });

  it('drops a cleared provider from memory and from storage', async () => {
    await store.getState().hydrate();
    await store.getState().setKey('groq', 'gsk_clear_me', true);
    await store.getState().clearKey('groq');

    expect(store.getState().keys.groq).toBeUndefined();
    expect(store.getState().remember.groq).toBeUndefined();
    expect(storage.getItem(SECRET_KEY)).toBeNull();
  });
});
