/**
 * One adapter for every endpoint that speaks the OpenAI chat-completions API:
 * OpenRouter, Groq, Mistral, Together, Ollama, custom base URLs, and this app's
 * own `free-proxy`.
 */

import { getCredentials, getKey, requireKey } from '../lib/credentials';
import { shellFetch } from '../lib/native/http';
import { configError, fromResponse, toProviderError } from './errors';
import { toChatCompletions } from './messages';
import { PROVIDERS, type ProviderId } from './providers';
import { getJson, iterateSSE, openStream, parseJsonFrame, readOpenAiChunk, type OpenAiChunk } from './transport';
import type { ChatProvider, ModelInfo, ProviderMessage, StreamEvent, StreamOptions } from './types';

interface DiscoveryEntry {
  id?: string;
  name?: string;
  model?: string;
  context_length?: number;
  max_context_length?: number;
}

interface DiscoveryResponse {
  data?: DiscoveryEntry[];
  models?: DiscoveryEntry[];
}

export interface OpenAiCompatConfig {
  id: ProviderId;
  /** Overrides the registry base URL (used by the free proxy). */
  baseUrl?: string;
  /** Some endpoints are happy with no Authorization header. */
  requiresKey?: boolean;
  /** Header name that the provider uses to track the calling app. */
  attribution?: boolean;
}

function resolveBaseUrl(id: ProviderId, override?: string): string {
  if (override) return override.replace(/\/$/, '');
  const creds = getCredentials();
  const entry = PROVIDERS[id];
  if (id === 'custom') {
    if (!creds.customBaseUrl) {
      throw new Error('No base URL set for the custom provider.');
    }
    return creds.customBaseUrl.replace(/\/+$/, '');
  }
  if (id === 'ollama') {
    return (creds.ollamaBaseUrl || entry.baseUrl || '').replace(/\/+$/, '');
  }
  return (entry.baseUrl ?? '').replace(/\/$/, '');
}

export function createOpenAiCompatProvider(config: OpenAiCompatConfig): ChatProvider {
  const entry = PROVIDERS[config.id];
  const label = entry.name;
  const needsKey = config.requiresKey ?? !entry.keyless;

  function resolveBase(): string {
    try {
      return resolveBaseUrl(config.id, config.baseUrl);
    } catch {
      throw configError(`Add the endpoint's base URL in Settings → Providers before using ${label}.`, label);
    }
  }

  function authHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...(entry.extraHeaders ?? {}) };
    if (config.attribution) {
      headers['http-referer'] = typeof location !== 'undefined' ? location.origin : '';
      headers['x-title'] = 'Chatbot';
    }
    if (needsKey) {
      headers.authorization = `Bearer ${requireKey(config.id, label, entry.keyUrl)}`;
    } else {
      const key = getKey(config.id);
      if (key) headers.authorization = `Bearer ${key}`;
    }
    return headers;
  }

  return {
    id: config.id,
    name: label,

    async listModels(signal): Promise<ModelInfo[]> {
      if (needsKey && !getKey(config.id)) return [];
      const base = resolveBase();
      const data = await getJson<DiscoveryResponse>(`${base}/models`, authHeaders(), label, signal);
      const list: DiscoveryEntry[] = data.data ?? data.models ?? [];
      return list
        .map((raw) => {
          const id = raw.id ?? raw.name ?? raw.model ?? '';
          return {
            id,
            label: raw.name && raw.name !== id ? raw.name : undefined,
            contextWindow: raw.context_length ?? raw.max_context_length,
            discovered: true,
          };
        })
        .filter((m) => Boolean(m.id) && m.id !== 'object');
    },

    async *stream(messages: ProviderMessage[], opts: StreamOptions, signal: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
      const base = resolveBase();
      const headers = authHeaders();
      const payload = toChatCompletions(messages, opts.system);
      if (!payload.length) {
        throw toProviderError(new Error('There is nothing to send yet.'), label);
      }

      const isOpenRouter = config.id === 'openrouter';
      const res = await openStream({
        url: `${base}/chat/completions`,
        headers,
        providerLabel: label,
        signal,
        body: {
          model: opts.model,
          messages: payload,
          stream: true,
          temperature: opts.temperature ?? 0.7,
          ...(opts.maxOutputTokens ? { max_tokens: opts.maxOutputTokens } : {}),
          // Only OpenRouter reliably returns a usage frame.
          ...(isOpenRouter ? { stream_options: { include_usage: true } } : {}),
        },
      });

      let sawDone = false;
      try {
        for await (const frame of iterateSSE(res.body as ReadableStream<Uint8Array>)) {
          const chunk = parseJsonFrame<OpenAiChunk>(frame);
          if (!chunk) continue;
          const delta = readOpenAiChunk(chunk);
          if (delta.error) {
            yield { type: 'status', text: `Provider error: ${delta.error.slice(0, 140)}` };
            continue;
          }
          if (delta.text) yield { type: 'delta', text: delta.text };
          if (delta.usage) yield { type: 'usage', inputTokens: delta.usage.inputTokens, outputTokens: delta.usage.outputTokens };
          if (delta.truncated) yield { type: 'status', text: 'Stopped at the output limit.' };
          if (delta.done) {
            sawDone = true;
            break;
          }
        }
        if (!sawDone) {
          // Stream ended without a finish_reason: still a successful completion.
          yield { type: 'done' };
          return;
        }
        yield { type: 'done' };
      } catch (err) {
        throw toProviderError(err, label);
      }
    },

    async test(signal) {
      const base = resolveBase();
      if (config.id === 'free-proxy') {
        let res: Response;
        try {
          res = await shellFetch(`${base}/health`, { signal });
        } catch (err) {
          throw toProviderError(err, label);
        }
        if (!res.ok) throw fromResponse(res.status, await res.text().catch(() => ''), label);
        const health = (await res.json()) as { configured?: boolean; model?: string };
        if (!health.configured) {
          throw fromResponse(501, '{"message":"not configured"}', label);
        }
        return { detail: `Shared free tier is live on ${health.model ?? 'a free model'}. Rate limited per minute.` };
      }
      let res: Response;
      try {
        res = await shellFetch(`${base}/models`, { headers: authHeaders(), signal });
      } catch (err) {
        throw toProviderError(err, label);
      }
      if (!res.ok) throw fromResponse(res.status, await res.text().catch(() => ''), label);
      return { detail: needsKey ? 'Key accepted. Models will load in the picker.' : 'Endpoint reachable.' };
    },
  };
}
