/**
 * Where a remembered API key actually lives.
 *
 *  - desktop → Electron's `safeStorage`, which is DPAPI on Windows and the
 *              Keychain on macOS. The encrypted blob is written by the main
 *              process into the app's user-data folder; the key never reaches a
 *              web storage API and never appears in a log.
 *  - android → the Android Keystore through `@aparajita/capacitor-secure-storage`
 *              (AES-GCM with a key that cannot leave the keystore).
 *  - web     → localStorage, because a browser has nowhere safer to put it. That
 *              is a real limitation, and the Settings panel says so in as many
 *              words rather than implying the key is encrypted.
 *
 * Only `loadRememberedKeys`/`rememberKey`/`forgetRememberedKey` touch provider
 * credentials. The same backend also holds the short-lived PKCE verifier, since
 * a native app can be killed and relaunched between the browser round trip.
 */

import type { ProviderId } from '../../providers/providers';
import { electronBridge, shellKind } from './platform';

const BAG_KEY = 'provider-keys';
const WEB_PREFIX = 'chatbot.secret.';

export interface KeyBag {
  version: 1;
  keys: Partial<Record<ProviderId, string>>;
}

interface SecretBackend {
  read(key: string): Promise<string | null>;
  write(key: string, value: string | null): Promise<void>;
  available(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

function webBackend(): SecretBackend {
  return {
    async available() {
      try {
        localStorage.setItem(`${WEB_PREFIX}probe`, '1');
        localStorage.removeItem(`${WEB_PREFIX}probe`);
        return true;
      } catch {
        return false;
      }
    },
    async read(key) {
      try {
        return localStorage.getItem(`${WEB_PREFIX}${key}`);
      } catch {
        return null;
      }
    },
    async write(key, value) {
      try {
        if (value === null) localStorage.removeItem(`${WEB_PREFIX}${key}`);
        else localStorage.setItem(`${WEB_PREFIX}${key}`, value);
      } catch {
        /* storage blocked: the key stays in memory for this session only */
      }
    },
  };
}

function electronBackend(): SecretBackend | null {
  const bridge = electronBridge();
  if (!bridge) return null;
  return {
    available: () => bridge.secureStorage.available().catch(() => false),
    read: (key) => bridge.secureStorage.get(key).catch(() => null),
    write: async (key, value) => {
      try {
        if (value === null) await bridge.secureStorage.remove(key);
        else await bridge.secureStorage.set(key, value);
      } catch {
        /* main process refused; caller reports it */
      }
    },
  };
}

async function keystorePlugin(): Promise<typeof import('@aparajita/capacitor-secure-storage').SecureStorage | null> {
  try {
    const mod = await import('@aparajita/capacitor-secure-storage');
    return mod.SecureStorage ?? null;
  } catch {
    return null;
  }
}

function keystoreBackend(): SecretBackend {
  return {
    async available() {
      return (await keystorePlugin()) !== null;
    },
    async read(key) {
      const plugin = await keystorePlugin();
      if (!plugin) return null;
      try {
        const value = await plugin.get(key);
        return typeof value === 'string' ? value : null;
      } catch {
        return null;
      }
    },
    async write(key, value) {
      const plugin = await keystorePlugin();
      if (!plugin) return;
      try {
        if (value === null) await plugin.remove(key);
        else await plugin.set(key, value);
      } catch {
        /* the plugin refused; callers keep the value in memory only */
      }
    },
  };
}

function selectedBackend(): SecretBackend {
  switch (shellKind()) {
    case 'electron':
      return electronBackend() ?? webBackend();
    case 'android':
      return keystoreBackend();
    default:
      return webBackend();
  }
}

let availabilityCache: boolean | null = null;

/** Whether a remembered key would survive a restart on this device right now. */
export async function secureStorageAvailable(): Promise<boolean> {
  if (availabilityCache === null) {
    availabilityCache = await selectedBackend().available();
  }
  return availabilityCache;
}

/**
 * The honest phrase for the Settings panel and the "remember" toggle hint.
 * Deliberately not a promise: the shell is known synchronously and the wording
 * is about *where*, not whether, storage works.
 */
export function secureStorageLabel(): string {
  switch (shellKind()) {
    case 'electron':
      return 'your operating system’s credential store';
    case 'android':
      return 'the Android Keystore';
    default:
      return 'this browser’s local storage (not encrypted)';
  }
}

// ---------------------------------------------------------------------------
// Provider keys
// ---------------------------------------------------------------------------

function parseBag(raw: string | null): KeyBag {
  const empty: KeyBag = { version: 1, keys: {} };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<KeyBag>;
    return { version: 1, keys: parsed.keys ?? {} };
  } catch {
    return empty;
  }
}

export async function loadRememberedKeys(): Promise<Partial<Record<ProviderId, string>>> {
  const raw = await selectedBackend().read(BAG_KEY);
  return parseBag(raw).keys;
}

async function writeBag(keys: Partial<Record<ProviderId, string>>): Promise<boolean> {
  const backend = selectedBackend();
  const remaining = Object.entries(keys).filter(([, value]) => Boolean(value));
  if (!remaining.length) {
    await backend.write(BAG_KEY, null);
    return true;
  }
  const bag: KeyBag = { version: 1, keys: Object.fromEntries(remaining) as KeyBag['keys'] };
  const before = await backend.read(BAG_KEY);
  await backend.write(BAG_KEY, JSON.stringify(bag));
  // A backend that silently drops the write (locked keychain, blocked storage)
  // must not look like success, or the UI would promise persistence it does not
  // have.
  const after = await backend.read(BAG_KEY);
  if (after === null && JSON.stringify(bag) !== before) return false;
  return after !== null;
}

export async function rememberKey(provider: ProviderId, key: string): Promise<boolean> {
  const existing = await loadRememberedKeys();
  const next = { ...existing, [provider]: key };
  const ok = await writeBag(next);
  if (ok) availabilityCache = true;
  return ok;
}

export async function forgetRememberedKey(provider: ProviderId): Promise<void> {
  const existing = await loadRememberedKeys();
  if (!(provider in existing)) return;
  const next = { ...existing };
  delete next[provider];
  await writeBag(next);
}

export async function forgetAllRememberedKeys(): Promise<void> {
  await selectedBackend().write(BAG_KEY, null);
}

// ---------------------------------------------------------------------------
// Short-lived OAuth material (PKCE verifier, CSRF state)
// ---------------------------------------------------------------------------

const OAUTH_PREFIX = 'oauth.';

export async function stashOAuthValue(name: string, value: string): Promise<void> {
  await selectedBackend().write(`${OAUTH_PREFIX}${name}`, value);
}

export async function readOAuthValue(name: string): Promise<string | null> {
  return selectedBackend().read(`${OAUTH_PREFIX}${name}`);
}

export async function dropOAuthValue(name: string): Promise<void> {
  await selectedBackend().write(`${OAUTH_PREFIX}${name}`, null);
}
