/**
 * OpenRouter OAuth (PKCE, S256).
 *
 * This is the only provider with a genuine one-click connect: the user authorises
 * once and OpenRouter mints an API key they own and can revoke. No client secret
 * exists, which is exactly why PKCE works from a client app.
 *
 * On the web the flow returns to the same page with `?code=`. In the desktop and
 * Android shells it opens the real browser (an embedded webview would be blocked
 * and would also see the user's provider password) and comes back via a redirect
 * URI: a loopback `http://127.0.0.1:…` for Electron, or a claimed HTTPS App Link
 * on Android when `VITE_OAUTH_REDIRECT` points at one. A custom scheme redirect
 * (`chatbot://oauth/callback`) is the documented Capacitor fallback, but OpenRouter
 * documents HTTPS and `localhost`/`127.0.0.1` loopbacks, not arbitrary scheme
 * redirects, so a loopback listener is the one redirect that is certain to work.
 *
 * Everything else in the app says "use an API key instead" rather than showing a
 * Connect button that cannot work.
 */

import { shellFetch } from './native/http';
import { closeExternalBrowser, oauthRedirectUri, onOAuthRedirect, openExternalUrl, parseOAuthRedirect } from './native/deeplink';
import { isNativeShell } from './native/platform';
import { dropOAuthValue, readOAuthValue, stashOAuthValue } from './native/secrets';

const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

/**
 * The PKCE verifier and CSRF state are short-lived secrets. On the web they live
 * in sessionStorage (gone with the tab, never shared). A native app can be
 * killed while the browser is in front, so there they also go to the platform
 * secret store, which is the only place that survives that without being
 * readable by anything else on the device.
 */
const TRANSIENT = { verifier: 'openrouter.verifier', state: 'openrouter.state' } as const;

async function stashTransient(name: string, value: string): Promise<void> {
  try {
    sessionStorage.setItem(`chatbot.oauth.${name}`, value);
  } catch {
    /* session storage can be blocked; the secret store below still has it */
  }
  if (isNativeShell()) await stashOAuthValue(name, value);
}

async function takeTransient(name: string): Promise<string | null> {
  let value: string | null = null;
  try {
    value = sessionStorage.getItem(`chatbot.oauth.${name}`);
  } catch {
    value = null;
  }
  if (!value && isNativeShell()) value = await readOAuthValue(name);
  return value;
}

async function clearTransient(name: string): Promise<void> {
  try {
    sessionStorage.removeItem(`chatbot.oauth.${name}`);
  } catch {
    /* nothing to clear */
  }
  if (isNativeShell()) await dropOAuthValue(name);
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(byteLength = 48): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function s256Challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

/** Leaves the app for OpenRouter, by the most appropriate route for the shell. */
export async function startOpenRouterConnect(): Promise<void> {
  const verifier = randomString();
  const state = randomString(16);
  const challenge = await s256Challenge(verifier);
  await stashTransient(TRANSIENT.verifier, verifier);
  await stashTransient(TRANSIENT.state, state);

  const url = new URL(AUTH_URL);
  url.searchParams.set('callback_url', oauthRedirectUri());
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('key_label', 'Chatbot');

  // Native shells hand off to the real browser and wait for the deep link.
  if (await openExternalUrl(url.toString())) return;
  window.location.assign(url.toString());
}

/** True when the given URL (or the current one) carries an OpenRouter code. */
export function isOpenRouterCallback(url?: string): boolean {
  const redirect = parseOAuthRedirect(url ?? window.location.href);
  return Boolean(redirect.code || redirect.error);
}

export interface OpenRouterAuthResult {
  key: string;
  logsUrl: string;
}

/**
 * Runs on boot when OpenRouter sent us back, or when a native deep link arrives.
 * Returns null when there is nothing to complete.
 */
export async function completeOpenRouterConnect(rawUrl?: string): Promise<OpenRouterAuthResult | null> {
  const redirect = parseOAuthRedirect(rawUrl ?? window.location.href);
  if (redirect.error) {
    await clearTransient(TRANSIENT.verifier);
    await clearTransient(TRANSIENT.state);
    throw new Error(redirect.description || `OpenRouter refused the connection (${redirect.error}).`);
  }
  const code = redirect.code;
  if (!code) return null;

  const expectedState = await takeTransient(TRANSIENT.state);
  if (expectedState && redirect.state && expectedState !== redirect.state) {
    throw new Error('This sign-in link did not come from this app. Start the connection again.');
  }

  const verifier = await takeTransient(TRANSIENT.verifier);

  // Through the shell transport: in the desktop app the browser-facing origin is
  // not a website, and on Android this is the request that would otherwise be
  // refused by CORS.
  const response = await shellFetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code,
      ...(verifier ? { code_verifier: verifier, code_challenge_method: 'S256' } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? 'OpenRouter refused that code. Codes expire after 10 minutes — start the connection again.'
        : `OpenRouter could not complete the connection (HTTP ${response.status}).`,
    );
  }

  const data = (await response.json()) as { key?: string };
  if (!data.key) throw new Error('OpenRouter did not return a key.');

  await clearTransient(TRANSIENT.verifier);
  await clearTransient(TRANSIENT.state);
  void closeExternalBrowser();

  // The code came back in the address bar only on the web; a deep link never
  // touched it. Strip it so a reload cannot replay it.
  if (!rawUrl) {
    const params = new URLSearchParams(window.location.search);
    params.delete('code');
    params.delete('state');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }

  const keyHash = await sha256Hex(data.key);
  return { key: data.key, logsUrl: `https://openrouter.ai/logs?api_key_hash=${keyHash}` };
}

/** Wires the native deep link into the same handler the web callback uses. */
export async function listenForNativeRedirects(handler: (url: string) => void): Promise<() => void> {
  if (!isNativeShell()) return () => {};
  return onOAuthRedirect(handler);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
