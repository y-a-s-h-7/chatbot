import { requireKey } from '../lib/credentials';
import { ProviderError, fromResponse, toProviderError } from './errors';
import { normalizeConversation } from './messages';
import { PROVIDERS } from './providers';
import { getJson, iterateSSE, openStream, parseJsonFrame } from './transport';
import type { ChatProvider, ModelInfo, ProviderMessage, StreamEvent, StreamOptions } from './types';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const ENTRY = PROVIDERS.gemini;

interface GeminiChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string; status?: string };
}

interface GeminiModelList {
  models?: Array<{
    name: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
}

function key(): string {
  return requireKey('gemini', ENTRY.name, ENTRY.keyUrl);
}

export const geminiProvider: ChatProvider = {
  id: 'gemini',
  name: ENTRY.name,

  async listModels(signal): Promise<ModelInfo[]> {
    const apiKey = key();
    const data = await getJson<GeminiModelList>(`${BASE}/models?pageSize=200`, { 'x-goog-api-key': apiKey }, ENTRY.name, signal);
    return (data.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => ({
        id: m.name.replace(/^models\//, ''),
        label: m.displayName ?? m.name,
        contextWindow: m.inputTokenLimit,
        discovered: true,
      }));
  },

  async *stream(messages: ProviderMessage[], opts: StreamOptions, signal: AbortSignal): AsyncGenerator<StreamEvent, void, void> {
    const apiKey = key();
    const { system, turns } = normalizeConversation(messages, opts.system);

    const body = {
      contents: turns.map((turn) => ({
        role: turn.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: turn.content }],
      })),
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      generationConfig: {
        temperature: opts.temperature ?? 0.7,
        ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      },
    };

    const res = await openStream({
      url: `${BASE}/models/${encodeURIComponent(opts.model)}:streamGenerateContent?alt=sse`,
      headers: { 'x-goog-api-key': apiKey },
      body,
      providerLabel: ENTRY.name,
      signal,
    });

    try {
      for await (const frame of iterateSSE(res.body as ReadableStream<Uint8Array>)) {
        const chunk = parseJsonFrame<GeminiChunk>(frame);
        if (!chunk) continue;
        if (chunk.error) {
          throw new ProviderError('bad_request', `**${ENTRY.name}** refused the request: ${chunk.error.message ?? 'unknown reason'}`, {
            providerLabel: ENTRY.name,
            retryable: false,
          });
        }
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text) yield { type: 'delta', text: part.text };
          }
        }
        if (chunk.usageMetadata) {
          yield {
            type: 'usage',
            inputTokens: chunk.usageMetadata.promptTokenCount,
            outputTokens: chunk.usageMetadata.candidatesTokenCount,
          };
        }
        const finish = chunk.candidates?.[0]?.finishReason;
        if (finish && finish !== 'STOP' && finish !== 'FINISH_REASON_UNSPECIFIED') {
          yield { type: 'status', text: finish === 'MAX_TOKENS' ? 'Stopped at the output limit.' : `Finished: ${finish.toLowerCase()}` };
        }
      }
      yield { type: 'done' };
    } catch (err) {
      throw toProviderError(err, ENTRY.name);
    }
  },

  async test(signal) {
    const apiKey = key();
    let res: Response;
    try {
      res = await fetch(`${BASE}/models?pageSize=1`, { headers: { 'x-goog-api-key': apiKey }, signal });
    } catch (err) {
      throw toProviderError(err, ENTRY.name);
    }
    if (!res.ok) throw fromResponse(res.status, await res.text().catch(() => ''), ENTRY.name);
    return { detail: 'Key accepted. Gemini models will load in the picker.' };
  },
};
