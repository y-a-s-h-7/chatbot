/**
 * The one interface every provider implements.
 *
 * Adding a provider means implementing this and registering it in `index.ts`.
 * Nothing else in the app knows how a given API shapes its request body.
 */

import type { ProviderId } from './providers';

export type Role = 'system' | 'user' | 'assistant';

/** The minimal shape adapters care about. ChatMessage is structurally compatible. */
export interface ProviderMessage {
  role: Role;
  content: string;
}

export interface StreamOptions {
  model: string;
  /** Optional system prompt / developer instruction. */
  system?: string;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ModelInfo {
  id: string;
  label?: string;
  contextWindow?: number;
  /** True when the list came from the provider's own /models endpoint. */
  discovered?: boolean;
}

export type StreamEvent =
  /** Progress or status the UI can show (model download, cold start, ...). */
  | { type: 'status'; text: string; progress?: number }
  | { type: 'delta'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number }
  | { type: 'done' };

export interface TestResult {
  detail: string;
}

export interface ChatProvider {
  id: ProviderId;
  name: string;
  /** Models this provider will answer with. May hit the network; never throws. */
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
  /** Streams a completion. Must honour `signal` and stop promptly. */
  stream(
    messages: ProviderMessage[],
    opts: StreamOptions,
    signal: AbortSignal,
  ): AsyncGenerator<StreamEvent, void, void>;
  /** Verifies credentials with the cheapest possible call. Throws ProviderError. */
  test(signal?: AbortSignal): Promise<TestResult>;
}
