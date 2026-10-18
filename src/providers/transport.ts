/**
 * Shared streaming plumbing: an SSE reader, and OpenAI-compatible chunk
 * decoding used by every adapter that speaks that dialect.
 */

import { shellFetch } from '../lib/native/http';
import { ProviderError, fromResponse, networkError, toProviderError } from './errors';

export interface SseFrame {
  event?: string;
  data: string;
}

/** Reads a `text/event-stream` body and yields one frame per event. */
export async function* iterateSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<SseFrame, void, void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let index: number;
      // Frames are separated by a blank line (handles \n\n and \r\n\r\n).
      while ((index = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, index);
        buffer = buffer.slice(index + (buffer[index] === '\r' ? 4 : 2));
        const frame = parseFrame(raw);
        if (frame) yield frame;
      }
    }
    buffer += decoder.decode();
    const tail = parseFrame(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseFrame(raw: string): SseFrame | null {
  const lines = raw.split(/\r?\n/);
  let event: string | undefined;
  const data: string[] = [];
  for (const line of lines) {
    if (!line || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length && !event) return null;
  return { event, data: data.join('\n') };
}

/** Parses one `data:` payload, tolerating keep-alives and provider noise. */
export function parseJsonFrame<T = unknown>(frame: SseFrame): T | null {
  const data = frame.data.trim();
  if (!data || data === '[DONE]') return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

export interface OpenAiChunk {
  choices?: Array<{
    index?: number;
    delta?: {
      content?: string | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
      role?: string;
    };
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
  error?: { message?: string; code?: string | number };
}

export interface OpenAiDelta {
  text?: string;
  done?: boolean;
  finish?: string | null;
  /** True when the provider stopped because the output limit was reached. */
  truncated?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: string;
}

/** Normalises one OpenAI-style chunk into what the app actually needs. */
export function readOpenAiChunk(chunk: OpenAiChunk): OpenAiDelta {
  if (chunk.error) return { error: chunk.error.message || String(chunk.error.code ?? 'provider error') };
  const choice = chunk.choices?.[0];
  const out: OpenAiDelta = {};
  const text = choice?.delta?.content;
  if (typeof text === 'string' && text.length > 0) out.text = text;
  if (choice?.finish_reason) {
    out.finish = choice.finish_reason;
    out.done = true;
    out.truncated = choice.finish_reason === 'length';
  }
  if (chunk.usage) {
    out.usage = {
      inputTokens: chunk.usage.prompt_tokens,
      outputTokens: chunk.usage.completion_tokens,
    };
  }
  return out;
}

export interface FetchStreamOptions {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  providerLabel: string;
  signal: AbortSignal;
  method?: string;
}

/** POSTs JSON and returns the streaming response, or throws a friendly error. */
export async function openStream(opts: FetchStreamOptions): Promise<Response> {
  const { url, headers, body, providerLabel, signal, method = 'POST' } = opts;
  let res: Response;
  try {
    // shellFetch, not fetch: in the desktop app this goes out through the main
    // process (real streaming, no CORS), and on Android it falls back to the
    // native stack for endpoints that refuse a WebView origin.
    res = await shellFetch(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: method === 'GET' ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    throw toProviderError(err, providerLabel);
  }
  if (!res.ok) {
    const text = await safeText(res);
    throw fromResponse(res.status, text, providerLabel);
  }
  if (!res.body) {
    throw new ProviderError(
      'unsupported',
      `**${providerLabel}** accepted the request but sent no stream back.`,
      { providerLabel },
    );
  }
  return res;
}

export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 4000);
  } catch {
    return '';
  }
}

/** GETs JSON with the same error translation. */
export async function getJson<T>(url: string, headers: Record<string, string>, providerLabel: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await shellFetch(url, { headers, signal });
  } catch (err) {
    throw toProviderError(err, providerLabel);
  }
  if (!res.ok) {
    const text = await safeText(res);
    throw fromResponse(res.status, text, providerLabel);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw networkError(providerLabel);
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'ProviderError';
}
