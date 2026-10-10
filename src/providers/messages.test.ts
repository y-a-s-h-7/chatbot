import { describe, expect, it } from 'vitest';
import { normalizeConversation, toChatCompletions } from './messages';
import type { ProviderMessage } from './types';

const msg = (role: ProviderMessage['role'], content: string): ProviderMessage => ({ role, content });

describe('normalizeConversation', () => {
  it('drops empty and whitespace-only turns', () => {
    const out = normalizeConversation([msg('user', ''), msg('assistant', '   '), msg('user', 'hi')]);
    expect(out.turns).toEqual([{ role: 'user', content: 'hi' }]);
    expect(out.system).toBe('');
  });

  it('collects system messages into a single system prompt', () => {
    const out = normalizeConversation([msg('system', 'be brief'), msg('user', 'hi')]);
    expect(out.system).toBe('be brief');
    expect(out.turns).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('merges consecutive same-role turns instead of breaking alternation', () => {
    const out = normalizeConversation([
      msg('user', 'one'),
      msg('user', 'two'),
      msg('assistant', 'ok'),
      msg('assistant', 'more'),
    ]);
    expect(out.turns).toEqual([
      { role: 'user', content: 'one\n\ntwo' },
      { role: 'assistant', content: 'ok\n\nmore' },
    ]);
  });

  it('drops leading assistant turns so the conversation starts with the user', () => {
    const out = normalizeConversation([
      msg('assistant', 'greeting from a previous context'),
      msg('user', 'hello'),
      msg('assistant', 'hi'),
    ]);
    expect(out.turns[0].role).toBe('user');
    expect(out.turns).toHaveLength(2);
  });

  it('treats unknown roles as user', () => {
    const rogue = { role: 'tool', content: 'tool output' } as unknown as ProviderMessage;
    const out = normalizeConversation([rogue]);
    expect(out.turns).toEqual([{ role: 'user', content: 'tool output' }]);
  });

  it('puts the system override first, before any stored system messages', () => {
    const out = normalizeConversation([msg('system', 'stored'), msg('user', 'hi')], 'override');
    expect(out.system).toBe('override\n\nstored');
  });

  it('ignores a blank system override', () => {
    const out = normalizeConversation([msg('system', 'stored'), msg('user', 'hi')], '   ');
    expect(out.system).toBe('stored');
  });

  it('returns an empty conversation for empty input', () => {
    const out = normalizeConversation([]);
    expect(out).toEqual({ system: '', turns: [] });
  });
});

describe('toChatCompletions', () => {
  it('emits the system message first, then alternating turns', () => {
    const out = toChatCompletions(
      [msg('user', 'q'), msg('assistant', 'a'), msg('system', 'be nice')],
      'override',
    );
    expect(out).toEqual([
      { role: 'system', content: 'override\n\nbe nice' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a' },
    ]);
  });

  it('omits the system entry entirely when there is no system text', () => {
    const out = toChatCompletions([msg('user', 'q')]);
    expect(out).toEqual([{ role: 'user', content: 'q' }]);
  });
});
