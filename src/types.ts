import type { ProviderId } from './providers/providers';
import type { Role } from './providers/types';

export type MessageStatus = 'pending' | 'streaming' | 'done' | 'stopped' | 'error';

export interface MessageError {
  title: string;
  message: string;
  retryable: boolean;
  action?: { label: string; href?: string };
}

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  status: MessageStatus;
  /** Snapshot of what answered, so a reply stays honest after a model switch. */
  modelId?: string;
  modelLabel?: string;
  providerId?: ProviderId;
  error?: MessageError;
  /** Provider-reported tokens, shown in the message footer. */
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Transient note from the provider, e.g. "Stopped at the output limit." */
  note?: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  modelId: string;
  messages: ChatMessage[];
}
