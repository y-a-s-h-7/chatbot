/**
 * Signing in from a native shell.
 *
 * Google (and every other serious provider) blocks OAuth from an embedded webview,
 * so the connect flow has to leave the app: the system browser or a Custom Tab
 * opens the provider's page, and the result comes back as a redirect URI — a
 * loopback `127.0.0.1:{port}` for Electron, or a claimed HTTPS App Link on Android
 * when that is configured, or the Capacitor `chatbot://oauth/callback` scheme as a
 * documented fallback.
 *
 * The redirect URI is overridable with `VITE_OAUTH_REDIRECT`, because the
 * production-grade version of this is a claimed HTTPS App Link on a domain you
 * control (see docs/native-builds.md).
 */

import { electronBridge, isNativeShell, shellKind } from './platform';

const OAUTH_FALLBACK_SCHEME = 'chatbot';
const OAUTH_FALLBACK_HOST = 'oauth';
const OAUTH_FALLBACK_HTTPS_FALLBACK = 'https://openrouter.ai/auth/return';
const OAUTH_LOCALHOST = 'http://127.0.0.1';

export const OAUTH_CALLBACK_SCHEME = OAUTH_FALLBACK_SCHEME;
export const OAUTH_CALLBACK = `${OAUTH_FALLBACK_SCHEME}://${OAUTH_FALLBACK_HOST}/callback`;

export function oauthRedirectUri(): string {
  const override = (import.meta.env.VITE_OAUTH_REDIRECT as string | undefined) ?? '';
  if (override) return override;
  switch (shellKind()) {
    case 'electron':
      return electronBridge()?.redirectUri ?? loopbackRedirect();
    case 'android':
      return OAUTH_FALLBACK_HTTPS_FALLBACK;
    default:
      return `${window.location.origin}${window.location.pathname}`;
  }
}

/** A loopback URI `127.0.0.1:{port}` the Electron main process is listening on. */
export function loopbackRedirect(): string {
  const bridge = electronBridge();
  if (!bridge) return `${OAUTH_LOCALHOST}:0`;
  try {
    return bridge.oauth.electronLoopbackRedirect?.() ?? `${OAUTH_LOCALHOST}:0`;
  } catch {
    return `${OAUTH_LOCALHOST}:0`;
  }
}

/** The placeholder in `electronBridge().oauth` that the preload script exposes. */
export interface ElectronLoopbackRedirect {
  /** Returns the loopback URI Electron is listening on, e.g. `http://127.0.0.1:59132`. */
  electronLoopbackRedirect?(): string;
}

export interface OAuthRedirect {
  /** The full URL we were handed, for diagnostics-free display. */
  url: string;
  code: string | null;
  state: string | null;
  error: string | null;
  description: string | null;
}

/**
 * Works for an absolute URL, a scheme link, a loopback URL, and a plain
 * `?code=…` query. Some providers return the parameters in the fragment, so that
 * is checked too.
 */
export function parseOAuthRedirect(raw: string): OAuthRedirect {
  const result: OAuthRedirect = { url: raw, code: null, state: null, error: null, description: null };
  let params: URLSearchParams | null = null;

  try {
    const parsed = new URL(raw);
    params = parsed.searchParams;
    if (![...params.keys()].length && parsed.hash.includes('?')) {
      params = new URLSearchParams(parsed.hash.slice(parsed.hash.indexOf('?') + 1));
    }
  } catch {
    const hashIndex = raw.indexOf('#');
    const withoutHash = hashIndex === -1 ? raw : raw.slice(0, hashIndex);
    const queryIndex = withoutHash.indexOf('?');
    params = new URLSearchParams(queryIndex === -1 ? '' : withoutHash.slice(queryIndex + 1));
  }

  result.code = params.get('code');
  result.state = params.get('state');
  result.error = params.get('error');
  result.description = params.get('error_description');
  return result;
}

/**
 * Opens a URL in the real browser. Returns false when there is no external
 * browser to hand off to, which is the signal to navigate the page instead.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  const bridge = electronBridge();
  if (bridge) {
    await bridge.oauth.open(url);
    return true;
  }
  if (shellKind() === 'android') {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Subscribes to the redirect that ends the flow: the deep link, the loopback
 * response, or the Android app-launch URL. Returns an unsubscribe function so an
 * unmount never leaves a listener (or a plugin handle) behind.
 *
 * OpenRouter documents HTTPS URLs and `http://localhost` / `http://127.0.0.1`
 * loopbacks as redirect targets, so the Electron flow opens a free loopback port
 * and uses that as the redirect URI — better than a custom scheme OpenRouter may
 * not redirect to. The `chatbot://` deep link is still wired because another
 * process may launch the app with it, but it is not the primary Electron flow.
 */
export async function onOAuthRedirect(handler: (url: string) => void): Promise<() => void> {
  const bridge = electronBridge();
  if (bridge) {
    // Electron: listen for the custom scheme deep link (for any cross-process
    // launch) AND for the loopback response. The loopback listener is kept alive
    // until the handler is unsubscribed.
    const schemeToken = bridge.oauth.subscribeRedirect((url: string) => {
      if (url.startsWith(`${OAUTH_FALLBACK_SCHEME}://${OAUTH_FALLBACK_HOST}/`)) {
        handler(url);
      }
    });
    return () => {
      bridge.oauth.unsubscribeRedirect(schemeToken);
    };
  }

  if (shellKind() === 'android') {
    try {
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appUrlOpen', (event: { url: string }) => handler(event.url));
      // Cold start: the app was launched *by* the redirect, before any of this
      // code existed, so the event above has already been and gone.
      try {
        const launch = await App.getLaunchUrl();
        if (launch?.url) {
          if (launch.url.startsWith(`${OAUTH_FALLBACK_SCHEME}://${OAUTH_FALLBACK_HOST}/`)) handler(launch.url);
          if (launch.url.startsWith(OAUTH_LOCALHOST)) handler(launch.url);
        }
      } catch {
        /* older plugin, or no launch URL */
      }
      return () => {
        void handle.remove();
      };
    } catch {
      return () => {};
    }
  }

  return () => {};
}

/** Closes the Custom Tab that hosted the provider's consent screen. */
export async function closeExternalBrowser(): Promise<void> {
  if (!isNativeShell()) return;
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch {
    /* nothing open, or unsupported */
  }
}
