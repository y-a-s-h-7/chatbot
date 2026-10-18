/**
 * One `fetch` for every shell.
 *
 * Browsers enforce CORS; the native shells do not have to. The three paths:
 *
 *  - web      → the platform fetch, exactly as before.
 *  - electron → IPC to the main process, which uses Chromium's network stack.
 *               No CORS, real progressive streaming, the system proxy honoured.
 *  - android  → try the platform fetch first, because it streams for real. Only
 *               when a provider refuses the WebView's origin do we replay the
 *               request through Capacitor's native HTTP, which is buffered, and
 *               therefore gets paced frame by frame on the way back in.
 *
 * Nothing here logs a header, a body or a key.
 */

import { uid } from '../utils';
import { pacedSseStream, singleChunkStream } from './pacing';
import { electronBridge, shellKind, type NativeHttpEvent } from './platform';

/** Hosts this session has learned it must reach through the native stack. */
const nativeOnlyHosts = new Set<string>();

function abortError(): DOMException {
  return new DOMException('The request was stopped.', 'AbortError');
}

function headerRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function normaliseHeaders(raw: unknown): Record<string, string> {
  const record: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return record;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'string') record[key.toLowerCase()] = value;
  }
  return record;
}

function toBytes(value: NativeHttpEvent['chunk']): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return new Uint8Array(value);
  return new Uint8Array(0);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Electron: IPC to the main process
// ---------------------------------------------------------------------------

interface StreamHead {
  status: number;
  statusText?: string;
  headers?: Record<string, string>;
  hasBody: boolean;
}

async function electronFetch(url: string, init: RequestInit): Promise<Response> {
  const bridge = electronBridge();
  if (!bridge) throw new TypeError('The desktop shell is not available.');

  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw abortError();

  const id = uid('http');
  const method = (init.method ?? 'POST').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : undefined;

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next;
    },
    // A cancelled read (Stop, unmount, model switch) tears the request down in
    // the main process instead of leaving a socket draining in the background.
    cancel() {
      bridge.http.abort(id);
    },
  });

  let resolveHead: (head: StreamHead) => void = () => {};
  let rejectHead: (reason: unknown) => void = () => {};
  const head = new Promise<StreamHead>((resolve, reject) => {
    resolveHead = resolve;
    rejectHead = reject;
  });

  let finished = false;
  let subscription = -1;

  const finish = () => {
    if (finished) return;
    finished = true;
    if (subscription >= 0) bridge.http.unsubscribe(subscription);
    signal?.removeEventListener('abort', onAbort);
  };

  const onAbort = () => {
    bridge.http.abort(id);
    const error = abortError();
    if (controller) {
      try {
        controller.error(error);
      } catch {
        /* already closed */
      }
    }
    rejectHead(error);
    finish();
  };

  let headSeen = false;
  subscription = bridge.http.subscribe((event) => {
    if (event.id !== id) return;
    switch (event.type) {
      case 'meta':
        headSeen = true;
        resolveHead({
          status: event.status ?? 200,
          statusText: event.statusText,
          headers: event.headers,
          hasBody: event.hasBody !== false,
        });
        break;
      case 'chunk':
        try {
          controller?.enqueue(toBytes(event.chunk));
        } catch {
          /* the reader went away */
        }
        break;
      case 'end':
        try {
          controller?.close();
        } catch {
          /* already closed */
        }
        finish();
        break;
      case 'error': {
        const error = new Error(event.message || 'The desktop shell could not reach that endpoint.');
        if (headSeen) {
          try {
            controller?.error(error);
          } catch {
            /* already closed */
          }
        } else {
          rejectHead(error);
        }
        finish();
        break;
      }
    }
  });

  signal?.addEventListener('abort', onAbort, { once: true });
  bridge.http.start({ id, url, method, headers: headerRecord(new Headers(init.headers ?? {})), body });

  const info = await head;
  return new Response(info.hasBody ? stream : null, {
    status: info.status,
    statusText: info.statusText,
    headers: info.headers,
  });
}

// ---------------------------------------------------------------------------
// Android: Capacitor's native HTTP (buffered, so paced)
// ---------------------------------------------------------------------------

function safeJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return body;
  }
}

async function capacitorFetch(url: string, init: RequestInit): Promise<Response> {
  const signal = init.signal ?? undefined;
  if (signal?.aborted) throw abortError();

  const { CapacitorHttp } = await import('@capacitor/core');
  const method = (init.method ?? 'POST').toUpperCase();
  const body = typeof init.body === 'string' ? init.body : undefined;

  let onAbort: (() => void) | null = null;
  const stopped = new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
  });

  try {
    const response = await Promise.race([
      CapacitorHttp.request({
        url,
        method,
        headers: headerRecord(new Headers(init.headers ?? {})),
        // Capacitor serialises this itself, so it has to be the object, not the
        // string we were handed.
        ...(body ? { data: safeJson(body) } : {}),
        responseType: 'text',
        connectTimeout: 30_000,
        // Reading is inactivity-based, not a total budget, so a slow model still
        // has as long as it needs while it is producing tokens.
        readTimeout: 300_000,
      }),
      stopped,
    ]);

    if (signal?.aborted) throw abortError();

    const status = typeof response.status === 'number' ? response.status : 200;
    const headers = normaliseHeaders(response.headers);
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
    const isStream = (headers['content-type'] ?? '').includes('event-stream');

    if (status === 204 || status === 205 || status === 304) {
      return new Response(null, { status, headers });
    }

    // A streamed answer is revealed frame by frame; anything else (an error
    // body, a JSON list) is delivered in one piece.
    const stream = isStream && status < 400 ? pacedSseStream(text) : singleChunkStream(text);
    return new Response(stream, { status, headers });
  } finally {
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * A CORS failure and an offline device look identical from JavaScript, so the
 * fallback is only attempted when the browser believes it is online.
 */
function looksLikeBlockedRequest(error: unknown): boolean {
  if (!(error instanceof TypeError)) return false;
  const message = String(error.message || '').toLowerCase();
  return message === '' || message.includes('failed to fetch') || message.includes('network') || message.includes('cors');
}

export async function shellFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const kind = shellKind();

  if (kind === 'web' || !/^https?:/i.test(url)) return globalThis.fetch(url, init);

  if (kind === 'electron') return electronFetch(url, init);

  const host = hostOf(url);
  if (!nativeOnlyHosts.has(host)) {
    try {
      return await globalThis.fetch(url, init);
    } catch (error) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (init.signal?.aborted || offline || !looksLikeBlockedRequest(error)) throw error;
      nativeOnlyHosts.add(host);
    }
  }
  return capacitorFetch(url, init);
}

/** Feedback for the picker/settings: which hosts we had to route natively. */
export function nativeRoutedHosts(): string[] {
  return [...nativeOnlyHosts];
}

export function resetNativeRoutingForTests(): void {
  nativeOnlyHosts.clear();
}
