import { requireKey } from '../lib/credentials';
import { ProviderError, fromResponse, toProviderError } from './errors';
import { normalizeConversation } from './messages';
import { PROVIDERS } from './providers';
import { getJson, iterateSSE, openStream, parseJsonFrame } from './transport';
import type { ChatProvider, ModelInfo, ProviderMessage, StreamEvent, StreamOptions } from './types';

const BASE = 'https://api.anthropic.com/v1';
const ENTRY = PROVIDERS.anthropic;
const VERSION = '2023-06-01';

/**
 * Anthropic's CORS support is opt-in per request through this header. It is
 * their documented switch for calling the Messages API from a browser, which is
 * exactly what we do — the user's key never touches our infrastructure.
 */
const BROWSER_HEADER = 'anthropic-dangerous-direct-browser-access';

interface AnthropicEvent {
  type?: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
  message?: { usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { type?: string; message?: string };
  content_block?: { type?: string; text?: string };
}

interface AnthropicModelList {
  data?: Array<{ id: string; display_name?: string }>;
}

const DEFAULT_MAX_OUTPUT = 8192;

function headers(apiKey: string): Record<string, string> {
  return {
    'x-api-key': apiKey,
    'anthropic-version': VERSION,
    [BROWSER_HEADER]: 'true',
  };
}

export const anthropicProvider: ChatProvider = {
  id: 'anthropic',
  name: ENTRY.name,

  async listModels(signal): Promise<ModelInfo[]> {
    const apiKey = requireKey('anthropic', ENTRY.name, ENTRY.keyUrl);
    const data = await getJson<AnthropicModelList>(`${BASE}/models?limit=100`, headers(apiKey), ENTRY.name, signal);
    return (data.data ?? []).map((m) => ({
      id: m.id,
      label: m.display_name ?? m.id,
      discovered: true,
    }));
  },

  async *stream(messages: ProviderMessage[], opts: StreamOptions, signal: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
    const apiKey = requireKey('anthropic', ENTRY.name, ENTRY.keyUrl);
    const { system, turns } = normalizeConversation(messages, opts.system);

    if (!turns.length) {
      throw new ProviderError('bad_request', 'There is nothing to send yet — type a message first.', {
        providerLabel: ENTRY.name,
        retryable: false,
      });
    }

    const res = await openStream({
      url: `${BASE}/messages`,
      headers: headers(apiKey),
      providerLabel: ENTRY.name,
      signal,
      body: {
        model: opts.model,
        max_tokens: opts.maxOutputTokens ?? DEFAULT_MAX_OUTPUT,
        ...(system ? { system } : {}),
        messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
        temperature: opts.temperature ?? 0.7,
        stream: true,
      },
    });

    try {
      for await (const frame of iterateSSE(res.body as ReadableStream<Uint8Array>)) {
        const event = parseJsonFrame<AnthropicEvent>(frame);
        if (!event) continue;
        const type = event.type ?? frame.event;

        if (type === 'error') {
          throw new ProviderError(
            'bad_request',
            `**${ENTRY.name}** refused the request: ${event.error?.message ?? 'unknown reason'}`,
            { providerLabel: ENTRY.name, retryable: false },
          );
        }
        if (type === 'content_block_delta' && event.delta?.type === 'text_delta' && event.delta.text) {
          yield { type: 'delta', text: event.delta.text };
        }
        if (type === 'message_start' && event.message?.usage) {
          yield { type: 'usage', inputTokens: event.message.usage.input_tokens };
        }
        if (type === 'message_delta') {
          if (event.usage) yield { type: 'usage', outputTokens: event.usage.output_tokens };
          if (event.delta?.stop_reason === 'max_tokens') {
            yield { type: 'status', text: 'Stopped at the output limit.' };
          }
        }
        if (type === 'message_stop') break;
      }
      yield { type: 'done' };
    } catch (err) {
      throw toProviderError(err, ENTRY.name);
    }
  },

  async test(signal) {
    const apiKey = requireKey('anthropic', ENTRY.name, ENTRY.keyUrl);
    let res: Response;
    try {
      res = await fetch(`${BASE}/models?limit=1`, { headers: headers(apiKey), signal });
    } catch (err) {
      throw toProviderError(err, ENTRY.name);
    }
    if (!res.ok) {
      throw fromResponse(res.status, await res.text().catch(() => ''), ENTRY.name);
    }
    return { detail: 'Key accepted. Claude models will load in the picker.' };
  },
};
