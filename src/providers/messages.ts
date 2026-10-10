import type { ProviderMessage } from './types';

export interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export interface NormalizedConversation {
  system: string;
  turns: Turn[];
}

/**
 * Every provider wants a well-formed conversation: a single system prompt, no
 * empty turns, and strictly alternating user/assistant starting with the user.
 * Doing this once here keeps the adapters small.
 */
export function normalizeConversation(messages: ProviderMessage[], systemOverride?: string): NormalizedConversation {
  const systems: string[] = [];
  const turns: Turn[] = [];

  for (const message of messages) {
    const content = (message.content ?? '').trim();
    if (!content) continue;
    if (message.role === 'system') {
      systems.push(content);
      continue;
    }
    const role: Turn['role'] = message.role === 'assistant' ? 'assistant' : 'user';
    const last = turns[turns.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      turns.push({ role, content });
    }
  }

  // A conversation must start with a user turn.
  while (turns.length && turns[0].role === 'assistant') turns.shift();

  if (systemOverride && systemOverride.trim()) systems.unshift(systemOverride.trim());

  return { system: systems.join('\n\n'), turns };
}

/** Roles as plain text, for the in-browser model which takes OpenAI-ish input. */
export function toChatCompletions(messages: ProviderMessage[], systemOverride?: string) {
  const { system, turns } = normalizeConversation(messages, systemOverride);
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (system) out.push({ role: 'system', content: system });
  for (const turn of turns) out.push({ role: turn.role, content: turn.content });
  return out;
}
