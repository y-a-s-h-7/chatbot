/**
 * One error type for everything a provider can throw, plus the human-readable
 * translation the UI shows. Raw JSON and stack traces never reach the screen.
 */

import { isNativeShell } from '../lib/native/platform';

export type ErrorCode =
  | 'auth'
  | 'forbidden'
  | 'rate_limit'
  | 'quota'
  | 'network'
  | 'server'
  | 'bad_request'
  | 'not_found'
  | 'context_length'
  | 'aborted'
  | 'not_configured'
  | 'unsupported'
  | 'webgpu_unavailable'
  | 'unknown';

export class ProviderError extends Error {
  code: ErrorCode;
  status?: number;
  providerLabel?: string;
  /** Whether "Retry" is likely to help. */
  retryable: boolean;
  /** Optional call to action, e.g. "Open Settings". */
  action?: { label: string; href?: string };

  constructor(
    code: ErrorCode,
    message: string,
    opts: { status?: number; providerLabel?: string; retryable?: boolean; action?: ProviderError['action'] } = {},
  ) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = opts.status;
    this.providerLabel = opts.providerLabel;
    this.retryable = opts.retryable ?? (code !== 'auth' && code !== 'forbidden' && code !== 'not_configured');
    this.action = opts.action;
  }
}

export function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    ((err as { name?: string }).name === 'AbortError' || (err as { code?: number }).code === 20)
  );
}

function bodyMessage(text: string): string | undefined {
  if (!text) return undefined;
  try {
    const data = JSON.parse(text) as Record<string, unknown>;
    const err = data?.error;
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const m = (err as { message?: unknown }).message;
      if (typeof m === 'string') return m;
    }
    const msgs = data?.message;
    if (typeof msgs === 'string') return msgs;
  } catch {
    /* not JSON */
  }
  return undefined;
}

/** Maps a failed HTTP response onto a ProviderError with a human explanation. */
export function fromResponse(status: number, bodyText: string, providerLabel: string, settingsHint = true): ProviderError {
  const upstream = bodyMessage(bodyText) ?? '';
  const base = { status, providerLabel } as const;

  if (status === 401 || status === 403) {
    return new ProviderError(
      status === 401 ? 'auth' : 'forbidden',
      `**${providerLabel}** rejected that API key. Check it was copied in full${
        settingsHint ? ', then paste it again in Settings → Providers.' : '.'
      }`,
      { ...base, retryable: false },
    );
  }
  if (status === 402) {
    return new ProviderError(
      'quota',
      `**${providerLabel}** says this account has no credit left. Top up, or switch to a free model from the picker.`,
      { ...base, retryable: false },
    );
  }
  if (status === 404) {
    return new ProviderError(
      'not_found',
      `**${providerLabel}** has no model with that ID any more. Pick another model — providers retire IDs without warning.`,
      { ...base, retryable: false },
    );
  }
  if (status === 429) {
    return new ProviderError(
      'rate_limit',
      `**${providerLabel}** is rate limiting these requests right now. Wait a few seconds and retry, or switch to another model from the picker.`,
      { ...base, retryable: true },
    );
  }
  // Google reports a rejected key as 400 INVALID_ARGUMENT, so the body has to
  // decide between "bad key" and "bad request".
  if (/api[_ ]?key[_ ]?(not valid|invalid)|invalid[_ ]api[_ ]key|api_key_invalid/i.test(upstream)) {
    return new ProviderError(
      'auth',
      `**${providerLabel}** rejected that API key. Check it was copied in full${settingsHint ? ', then paste it again in Settings → Providers.' : '.'}`,
      { ...base, retryable: false },
    );
  }
  if (status === 400 && /context|too long|max.*token|length/i.test(upstream)) {
    return new ProviderError(
      'context_length',
      `This conversation no longer fits in the context window of **${providerLabel}**. Start a new chat, or delete a few earlier messages.`,
      { ...base, retryable: false },
    );
  }
  if (status === 400 || status === 422) {
    return new ProviderError(
      'bad_request',
      `**${providerLabel}** could not accept that request${upstream ? `: ${upstream.slice(0, 180)}` : '.'}`,
      { ...base, retryable: false },
    );
  }
  if (status >= 500) {
    return new ProviderError(
      'server',
      `**${providerLabel}** is having trouble on its side (HTTP ${status}). Retry in a moment.`,
      { ...base, retryable: true },
    );
  }
  return new ProviderError(
    'unknown',
    `**${providerLabel}** returned an unexpected response (HTTP ${status}).`,
    { ...base, retryable: status >= 500 },
  );
}

export function networkError(providerLabel: string): ProviderError {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  if (offline) {
    return new ProviderError('network', 'You appear to be offline. Reconnect and retry — your message is still here.', {
      providerLabel,
      retryable: true,
    });
  }
  // In the desktop and Android shells the request does not go through the page,
  // so CORS is not a candidate cause and saying so would send the user hunting
  // for a problem that cannot exist there.
  const native = isNativeShell();
  return new ProviderError(
    'network',
    native
      ? `Could not reach **${providerLabel}**. The usual causes are a dropped connection, a VPN or proxy in the way, or a local runtime that is not running.`
      : `Could not reach **${providerLabel}**. The usual causes are a dropped connection, a VPN or proxy in the way, an ad-blocking extension, or the provider blocking browser requests (CORS). A local runtime also has to be running and allowing this page's origin.`,
    { providerLabel, retryable: true },
  );
}

/**
 * A `fetch` that fails because the endpoint is misconfigured is not a network
 * problem the user can retry their way out of, so it gets its own code.
 */
export function configError(message: string, providerLabel: string): ProviderError {
  return new ProviderError('not_configured', message, { providerLabel, retryable: false });
}

export function toProviderError(err: unknown, providerLabel: string): ProviderError {
  if (err instanceof ProviderError) return err;
  if (isAbortError(err)) return new ProviderError('aborted', 'Stopped.', { providerLabel, retryable: false });
  if (err instanceof TypeError) return networkError(providerLabel);
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError('unknown', `Something went wrong talking to **${providerLabel}**${message ? `: ${message.slice(0, 160)}` : '.'}`, {
    providerLabel,
    retryable: true,
  });
}

/** True when the message is safe to show as-is (we wrote it). */
export function isFriendly(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}
