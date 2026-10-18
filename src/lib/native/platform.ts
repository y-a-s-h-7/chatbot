/**
 * Which shell is hosting the app, and what that shell can do for us.
 *
 * The web build must stay exactly as it is, so nothing here imports a native
 * package at module scope: the Electron bridge is injected by the preload
 * script, and Capacitor plugins are imported lazily inside the calls that need
 * them. That keeps every native dependency out of the initial page load.
 */

export type ShellKind = 'web' | 'electron' | 'android';

/** One event from the Electron main process while a request is in flight. */
export interface NativeHttpEvent {
  id: string;
  type: 'meta' | 'chunk' | 'end' | 'error';
  /** meta: the response line, sent before any body bytes. */
  status?: number;
  statusText?: string;
  headers?: Record<string, string>;
  hasBody?: boolean;
  /** chunk: raw bytes, structured-cloned across the IPC boundary. */
  chunk?: Uint8Array | ArrayBuffer | number[];
  /** error: a message safe to show (never a token or a key). */
  message?: string;
}

export interface ElectronNativeHttp {
  start(request: { id: string; url: string; method: string; headers: Record<string, string>; body?: string }): void;
  abort(id: string): void;
  /** Returns a numeric token: an unsubscribe function would have to survive the
   *  context bridge, and a token is a plain value that always does. */
  subscribe(handler: (event: NativeHttpEvent) => void): number;
  unsubscribe(token: number): void;
}

export interface ElectronSecureStorage {
  available(): Promise<boolean>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<boolean>;
  remove(key: string): Promise<boolean>;
}

export interface ElectronBridge {
  shell: 'electron';
  version: string;
  platform: string;
  redirectUri: string;
  http: ElectronNativeHttp;
  secureStorage: ElectronSecureStorage;
  oauth: {
    /** Opens the system browser. Never an embedded webview — Google blocks those. */
    open(url: string): Promise<boolean>;
    /** Wires up the custom-scheme deep link listener. */
    subscribeRedirect(handler: (url: string) => void): number;
    unsubscribeRedirect(token: number): void;
    /** Returns the loopback URI Electron is listening on, or undefined. */
    electronLoopbackRedirect(): string | undefined;
  };
  info(): Promise<{ app: string; electron: string; chrome: string; node: string }>;
}

declare global {
  interface Window {
    chatbotNative?: ElectronBridge;
    Capacitor?: { isNativePlatform?(): boolean; getPlatform?(): string };
  }
}

let cached: ShellKind | null = null;

/**
 * Capacitor serves the bundle from a WebView, which announces itself in the user
 * agent. Checking `window.Capacitor` alone is not enough: it only exists once the
 * core package has been imported, and this has to answer synchronously on boot.
 */
function looksLikeCapacitorWebView(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/(iPhone|iPad|iPod)/.test(ua)) return false;
  if (!/Android/i.test(ua)) return false;
  return /\bwv\b/.test(ua) || /Capacitor/i.test(ua) || (window.Capacitor?.isNativePlatform?.() ?? false);
}

export function shellKind(): ShellKind {
  if (cached) return cached;
  let kind: ShellKind = 'web';
  if (typeof window !== 'undefined') {
    if (window.chatbotNative?.shell === 'electron') kind = 'electron';
    else if (looksLikeCapacitorWebView()) kind = 'android';
  }
  cached = kind;
  return kind;
}

export function isNativeShell(): boolean {
  return shellKind() !== 'web';
}

export function nativeShellName(): string {
  switch (shellKind()) {
    case 'electron':
      return 'Desktop app';
    case 'android':
      return 'Android app';
    default:
      return 'Browser';
  }
}

/** The Electron bridge, or null in every other shell. */
export function electronBridge(): ElectronBridge | null {
  return shellKind() === 'electron' ? (window.chatbotNative ?? null) : null;
}

/** Only used by tests: forget the memoised detection. */
export function resetShellKindForTests(): void {
  cached = null;
}
