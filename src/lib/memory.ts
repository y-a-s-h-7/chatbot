/**
 * Long-term memory, without an LLM deciding what to store.
 *
 * Small local models are unreliable at spotting what is worth remembering, so the
 * app saves a fact only when the user asks for it in so many words — "remember
 * that my name is X". Facts live in localStorage on this device, and the ones that
 * fit are added to the system prompt of every request. Nothing else reads them.
 *
 * Everything here is pure except `loadMemory`/`saveMemory`.
 */

import { uid } from './utils';

export interface MemoryFact {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryState {
  version: 1;
  enabled: boolean;
  facts: MemoryFact[];
}

export const MEMORY_KEY = 'chatbot.memory.v1';

/** The injected block rides along with every request, so it stays small. */
export const MAX_FACTS = 40;
export const MAX_FACT_LENGTH = 240;
/** Roughly 150 tokens — leaves room for a real conversation on a 4K-context model. */
export const MEMORY_CHAR_BUDGET = 600;

export const EMPTY_MEMORY: MemoryState = { version: 1, enabled: true, facts: [] };

/**
 * Sent with every request, with or without facts. Without it a model answers
 * "of course, I'll remember that" while the app has stored nothing, which is
 * exactly the promise this feature exists to stop it making.
 */
export const MEMORY_RULES = [
  'You have no memory of your own: this conversation is the only context you have,',
  'and nothing is carried over between chats. Never say that you will remember',
  'something, and never claim to know a fact about the user that is not listed in',
  'this prompt. If the user asks you to remember something, tell them to start a',
  'message with "remember that ..." — that is the only way the app can save it.',
].join(' ');

/** Triggers, most specific first, so "remember that X" beats the bare "remember X". */
const TRIGGERS: RegExp[] = [
  /^(?:please\s+|hey\s+|ok(?:ay)?\s+|also\s+)*(?:remember|note|keep in mind|bear in mind)\s+that\s+(.+)$/i,
  /^(?:please\s+|hey\s+|ok(?:ay)?\s+|also\s+)*(?:remember|note)\s*[:—–-]\s*(.+)$/i,
  /^(?:please\s+|hey\s+|ok(?:ay)?\s+|also\s+)*(?:remember|don'?t forget|do not forget|make a note)\s+(.+)$/i,
];

/**
 * A fact a person would actually want back: trimmed, unquoted, capitalised and
 * capped. Returns '' when nothing usable is left.
 */
export function normalizeFact(raw: string): string {
  const text = raw
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["'“”‘’\s]+/, '')
    .replace(/["'“”‘’\s]+$/, '')
    .replace(/[.!;,\s]+$/, '');
  if (text.length < 3) return '';
  return text.charAt(0).toUpperCase() + text.slice(1, MAX_FACT_LENGTH);
}

export function extractMemoryCommand(message: string): string | null {
  const text = message.trim();
  // A question is not an instruction, and a long message is not a fact.
  if (!text || text.endsWith('?') || text.length > 400) return null;
  for (const trigger of TRIGGERS) {
    const match = trigger.exec(text);
    if (!match) continue;
    const fact = normalizeFact(match[1] ?? '');
    if (fact) return fact;
  }
  return null;
}

const SECRET_PATTERNS: RegExp[] = [
  // Credentials whose shape we recognise.
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
  // Anything labelled like a credential.
  /\b(?:password|passphrase|passcode|pin|api[\s_-]?key|secret|access[\s_-]?token|auth[\s_-]?token|bearer|private[\s_-]?key|cvv|social[\s_-]?security|ssn|credit[\s_-]?card|card[\s_-]?number|iban)\b/i,
  // A long unbroken run of characters: nearly always a token or a hash.
  /\b[A-Za-z0-9+/=_-]{32,}\b/,
];

/** Memory is for preferences and facts, never for credentials. */
export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Adds a fact, or refreshes the one it duplicates (case-insensitively, so saying
 * the same thing twice does not fill the list with near-identical rows).
 */
export function upsertFact(
  facts: MemoryFact[],
  text: string,
  now = Date.now(),
  id = uid('mem'),
): { facts: MemoryFact[]; fact: MemoryFact } {
  const duplicate = facts.find((item) => item.text.toLowerCase() === text.toLowerCase());
  if (duplicate) {
    const fact: MemoryFact = { ...duplicate, text, updatedAt: now };
    return { facts: [fact, ...facts.filter((item) => item.id !== duplicate.id)], fact };
  }
  const fact: MemoryFact = { id, text, createdAt: now, updatedAt: now };
  return { facts: [fact, ...facts].slice(0, MAX_FACTS), fact };
}

/**
 * Relevance, for facts we do not understand: newest first, as many as fit in the
 * budget. Skipping an oversized fact rather than stopping keeps room for the
 * shorter ones behind it.
 */
export function selectFacts(facts: MemoryFact[]): MemoryFact[] {
  const ranked = [...facts].sort((a, b) => b.updatedAt - a.updatedAt);
  const selected: MemoryFact[] = [];
  let used = 0;
  for (const fact of ranked) {
    const cost = fact.text.length + 3; // "- " plus the line break
    if (used + cost > MEMORY_CHAR_BUDGET) continue;
    selected.push(fact);
    used += cost;
  }
  return selected;
}

/** The system-prompt section: ground rules plus whatever facts are available. */
export function buildMemorySection(state: MemoryState): string {
  const lines = [MEMORY_RULES];
  const facts = state.enabled ? selectFacts(state.facts) : [];
  if (facts.length) {
    lines.push(
      `Known facts about the user, saved on this device at their request:\n${facts
        .map((fact) => `- ${fact.text}`)
        .join('\n')}`,
    );
  } else if (state.enabled) {
    lines.push('No facts about the user have been saved yet.');
  } else {
    lines.push('The user switched saved memory off, so no facts about them are available.');
  }
  return lines.join('\n\n');
}

/** Anything unreadable, or written by an older version, falls back to empty. */
export function loadMemory(): MemoryState {
  try {
    const raw = localStorage.getItem(MEMORY_KEY);
    if (!raw) return { ...EMPTY_MEMORY };
    const parsed = JSON.parse(raw) as Partial<MemoryState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.facts)) return { ...EMPTY_MEMORY };

    const facts: MemoryFact[] = [];
    const now = Date.now();
    for (const candidate of parsed.facts as unknown[]) {
      if (!candidate || typeof candidate !== 'object') continue;
      const record = candidate as Partial<MemoryFact>;
      if (typeof record.text !== 'string' || !record.text.trim()) continue;
      facts.push({
        id: typeof record.id === 'string' && record.id ? record.id : uid('mem'),
        text: record.text.trim().slice(0, MAX_FACT_LENGTH),
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : now,
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : now,
      });
      if (facts.length >= MAX_FACTS) break;
    }
    return { version: 1, enabled: parsed.enabled !== false, facts };
  } catch {
    return { ...EMPTY_MEMORY };
  }
}

export function saveMemory(state: MemoryState): void {
  try {
    localStorage.setItem(
      MEMORY_KEY,
      JSON.stringify({ version: 1, enabled: state.enabled, facts: state.facts.slice(0, MAX_FACTS) }),
    );
  } catch {
    /* storage blocked: memory lives in this tab only, which the panel says */
  }
}
