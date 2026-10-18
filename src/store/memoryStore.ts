import { create } from 'zustand';
import {
  EMPTY_MEMORY,
  MAX_FACT_LENGTH,
  buildMemorySection,
  extractMemoryCommand,
  loadMemory,
  looksLikeSecret,
  normalizeFact,
  saveMemory,
  upsertFact,
  type MemoryFact,
} from '../lib/memory';
import { uid } from '../lib/utils';

/**
 * Saved facts about the user. Small enough for localStorage, and kept apart from
 * the settings store so a reset of preferences cannot silently delete them.
 */

export type RememberOutcome =
  /** The app stored the fact, so the model may honestly say it will not forget it. */
  | { kind: 'saved'; fact: MemoryFact }
  /** Looked like a credential; never written anywhere. */
  | { kind: 'secret' }
  /** The user asked, but "Use memory" is off. */
  | { kind: 'disabled' }
  /** The message was not a request to remember anything. */
  | { kind: 'none' };

interface MemoryStoreState {
  hydrated: boolean;
  enabled: boolean;
  facts: MemoryFact[];

  hydrate(): void;
  setEnabled(value: boolean): void;
  add(text: string): MemoryFact | null;
  update(id: string, text: string): void;
  remove(id: string): void;
  clearAll(): void;
  /** Watches an outgoing message for an explicit "remember that …" request. */
  rememberIfAsked(message: string): RememberOutcome;
  /** The section appended to the system prompt of every request. */
  section(): string;
}

export const useMemoryStore = create<MemoryStoreState>((set, get) => {
  const commit = (facts: MemoryFact[], enabled = get().enabled) => {
    set({ facts, enabled });
    saveMemory({ version: 1, enabled, facts });
  };

  return {
    hydrated: false,
    enabled: EMPTY_MEMORY.enabled,
    facts: [],

    hydrate() {
      if (get().hydrated) return;
      const stored = loadMemory();
      set({ hydrated: true, enabled: stored.enabled, facts: stored.facts });
    },

    setEnabled(enabled) {
      commit(get().facts, enabled);
    },

    add(text) {
      const fact = normalizeFact(text);
      if (!fact || looksLikeSecret(fact)) return null;
      const next = upsertFact(get().facts, fact, Date.now(), uid('mem'));
      commit(next.facts);
      return next.fact;
    },

    update(id, text) {
      const fact = normalizeFact(text);
      if (!fact) return;
      commit(
        get().facts.map((item) =>
          item.id === id ? { ...item, text: fact.slice(0, MAX_FACT_LENGTH), updatedAt: Date.now() } : item,
        ),
      );
    },

    remove(id) {
      commit(get().facts.filter((item) => item.id !== id));
    },

    clearAll() {
      commit([]);
    },

    rememberIfAsked(message) {
      const requested = extractMemoryCommand(message);
      if (!requested) return { kind: 'none' };
      if (!get().enabled) return { kind: 'disabled' };
      if (looksLikeSecret(requested)) return { kind: 'secret' };
      const next = upsertFact(get().facts, requested, Date.now(), uid('mem'));
      commit(next.facts);
      return { kind: 'saved', fact: next.fact };
    },

    section() {
      return buildMemorySection({ version: 1, enabled: get().enabled, facts: get().facts });
    },
  };
});
