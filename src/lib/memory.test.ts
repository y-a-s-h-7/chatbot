import { describe, expect, it } from 'vitest';
import {
  MAX_FACT_LENGTH,
  MEMORY_CHAR_BUDGET,
  buildMemorySection,
  extractMemoryCommand,
  looksLikeSecret,
  normalizeFact,
  selectFacts,
  upsertFact,
  type MemoryFact,
} from './memory';

function fact(text: string, updatedAt = 1): MemoryFact {
  return { id: text, text, createdAt: updatedAt, updatedAt };
}

describe('extractMemoryCommand', () => {
  it('reads the fact out of an explicit request', () => {
    expect(extractMemoryCommand('remember that my name is Sam')).toBe('My name is Sam');
    expect(extractMemoryCommand('Please remember that I prefer metric units')).toBe('I prefer metric units');
    expect(extractMemoryCommand('note that I work in Berlin')).toBe('I work in Berlin');
    expect(extractMemoryCommand('keep in mind that I am vegetarian')).toBe('I am vegetarian');
    expect(extractMemoryCommand('remember: my birthday is in June')).toBe('My birthday is in June');
  });

  it('accepts the shorter "remember my ..." form', () => {
    expect(extractMemoryCommand('remember my timezone is IST')).toBe('My timezone is IST');
  });

  it('leaves ordinary messages alone', () => {
    expect(extractMemoryCommand('what is my name?')).toBeNull();
    expect(extractMemoryCommand('do you remember my name')).toBeNull();
    expect(extractMemoryCommand('tell me about Romania')).toBeNull();
    expect(extractMemoryCommand('')).toBeNull();
  });

  it('treats a question as a question, not an instruction to store something', () => {
    expect(extractMemoryCommand('remember that?')).toBeNull();
    expect(extractMemoryCommand('remember my name?')).toBeNull();
  });

  it('ignores requests too long to be a fact', () => {
    expect(extractMemoryCommand(`remember that ${'x'.repeat(500)}`)).toBeNull();
  });
});

describe('normalizeFact', () => {
  it('trims, unquotes and capitalises', () => {
    expect(normalizeFact('  " my name is sam "  ')).toBe('My name is sam');
    expect(normalizeFact('I like tea.')).toBe('I like tea');
  });

  it('caps the length and rejects fragments', () => {
    expect(normalizeFact('x'.repeat(500))).toHaveLength(MAX_FACT_LENGTH);
    expect(normalizeFact('a')).toBe('');
  });
});

describe('looksLikeSecret', () => {
  it('refuses credentials of every shape we recognise', () => {
    expect(looksLikeSecret('My OpenAI key is sk-abcdefghijklmnopqrstuvwx')).toBe(true);
    expect(looksLikeSecret('The api key is 9f2c1a7b')).toBe(true);
    expect(looksLikeSecret('my password is hunter2')).toBe(true);
    expect(looksLikeSecret('card number 4111 1111 1111 1111')).toBe(true);
    expect(looksLikeSecret('token: Zx8Yq2LmNpQr4StUvWx1YzAbCdEfGhIj')).toBe(true);
  });

  it('keeps ordinary facts', () => {
    expect(looksLikeSecret('My name is Sam')).toBe(false);
    expect(looksLikeSecret('I prefer short answers')).toBe(false);
    expect(looksLikeSecret('My email is sam@example.com')).toBe(false);
  });
});

describe('upsertFact', () => {
  it('adds newest first', () => {
    const first = upsertFact([], 'My name is Sam', 1, 'a');
    const second = upsertFact(first.facts, 'I like tea', 2, 'b');
    expect(second.facts.map((item) => item.text)).toEqual(['I like tea', 'My name is Sam']);
  });

  it('refreshes a duplicate instead of storing it twice', () => {
    const first = upsertFact([], 'My name is Sam', 1, 'a');
    const second = upsertFact(first.facts, 'my name is Sam', 5, 'b');
    expect(second.facts).toHaveLength(1);
    expect(second.facts[0]).toMatchObject({ id: 'a', text: 'my name is Sam', createdAt: 1, updatedAt: 5 });
  });
});

describe('selectFacts', () => {
  it('keeps the newest and stays inside the budget', () => {
    const facts = Array.from({ length: 40 }, (_, index) => fact(`Fact number ${index}`, index));
    const selected = selectFacts(facts);
    const used = selected.reduce((total, item) => total + item.text.length + 3, 0);
    expect(used).toBeLessThanOrEqual(MEMORY_CHAR_BUDGET);
    expect(selected[0]?.text).toBe('Fact number 39');
    expect(selected.length).toBeLessThan(facts.length);
  });

  it('skips an oversized fact rather than the shorter ones behind it', () => {
    const huge = fact('h'.repeat(MEMORY_CHAR_BUDGET), 9);
    const small = fact('My name is Sam', 1);
    expect(selectFacts([huge, small]).map((item) => item.text)).toEqual(['My name is Sam']);
  });
});

describe('buildMemorySection', () => {
  it('lists facts when memory is on', () => {
    const section = buildMemorySection({ version: 1, enabled: true, facts: [fact('My name is Sam', 1)] });
    expect(section).toContain('My name is Sam');
    expect(section).toContain('Never say that you will remember');
  });

  it('says nothing is known yet when the list is empty', () => {
    expect(buildMemorySection({ version: 1, enabled: true, facts: [] })).toContain('No facts about the user');
  });

  it('keeps the ground rules but drops the facts when memory is off', () => {
    const section = buildMemorySection({ version: 1, enabled: false, facts: [fact('My name is Sam', 1)] });
    expect(section).not.toContain('My name is Sam');
    expect(section).toContain('switched saved memory off');
    expect(section).toContain('Never say that you will remember');
  });
});
