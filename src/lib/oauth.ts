/**
 * OpenRouter OAuth (PKCE, S256).
 *
 * This is the only provider with a genuine one-click connect: the user authorises
 * once and OpenRouter mints an API key they own and can revoke. No client secret
 * exists, which is exactly why PKCE works from a pure browser app.
 *
 * Everything else in the app says "use an API key instead" rather than showing a
 * Connect button that cannot work.
 */

const AUTH_URL = 'https://openrouter.ai/auth';
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';
const VERIFIER_KEY = 'chatbot.oauth.openrouter.verifier';
const STATE_KEY = 'chatbot.oauth.openrouter.state';

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

function callbackUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

/** Leaves the app for OpenRouter. We come back to the same URL with ?code=. */
export async function startOpenRouterConnect(): Promise<void> {
  const verifier = randomString();
  const state = randomString(16);
  const challenge = await s256Challenge(verifier);
  try {
    sessionStorage.setItem(VERIFIER_KEY, verifier);
    sessionStorage.setItem(STATE_KEY, state);
  } catch {
    // Session storage can be blocked. The verifier is then only good for this
    // exact page life, which is all the flow needs anyway.
  }

  const url = new URL(AUTH_URL);
  url.searchParams.set('callback_url', callbackUrl());
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('key_label', 'Chatbot');
  window.location.assign(url.toString());
}

export function isOpenRouterCallback(): boolean {
  const params = new URLSearchParams(window.location.search);
  return params.has('code') && window.location.pathname.length >= 0;
}

export interface OpenRouterAuthResult {
  key: string;
  logsUrl: string;
}

/** Runs on boot when OpenRouter sent us back. Returns null when there is no code. */
export async function completeOpenRouterConnect(): Promise<OpenRouterAuthResult | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return null;

  const expectedState = (() => {
    try {
      return sessionStorage.getItem(STATE_KEY);
    } catch {
      return null;
    }
  })();
  const returnedState = params.get('state');
  if (expectedState && returnedState && expectedState !== returnedState) {
    throw new Error('This sign-in link did not come from this tab. Start the connection again.');
  }

  let verifier: string | null = null;
  try {
    verifier = sessionStorage.getItem(VERIFIER_KEY);
  } catch {
    verifier = null;
  }

  const response = await fetch(EXCHANGE_URL, {
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

  try {
    sessionStorage.removeItem(VERIFIER_KEY);
    sessionStorage.removeItem(STATE_KEY);
  } catch {
    /* nothing to clean */
  }

  // Strip the code from the address bar so a reload cannot replay it.
  params.delete('code');
  params.delete('state');
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);

  const keyHash = await sha256Hex(data.key);
  return { key: data.key, logsUrl: `https://openrouter.ai/logs?api_key_hash=${keyHash}` };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
