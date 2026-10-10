import { beforeEach, describe, expect, it } from 'vitest';
import { getCredentials, getKey, maskKey, requireKey, setCredentials } from './credentials';
import { ProviderError } from '../providers/errors';

beforeEach(() => {
  setCredentials({ keys: {}, connected: {}, customBaseUrl: '', ollamaBaseUrl: '' });
});

describe('setCredentials / getCredentials', () => {
  it('starts empty', () => {
    const snap = getCredentials();
    expect(snap.keys).toEqual({});
    expect(snap.connected).toEqual({});
    expect(snap.customBaseUrl).toBe('');
    expect(snap.ollamaBaseUrl).toBe('');
  });

  it('returns the most recent snapshot', () => {
    setCredentials({ keys: { gemini: 'k1' }, connected: {}, customBaseUrl: '', ollamaBaseUrl: '' });
    setCredentials({ keys: { gemini: 'k2' }, connected: {}, customBaseUrl: '', ollamaBaseUrl: '' });
    expect(getKey('gemini')).toBe('k2');
  });
});

describe('getKey', () => {
  it('trims whitespace around a pasted key', () => {
    setCredentials({ keys: { anthropic: '  sk-ant-abc  ' }, connected: {}, customBaseUrl: '', ollamaBaseUrl: '' });
    expect(getKey('anthropic')).toBe('sk-ant-abc');
  });

  it('treats whitespace-only keys as absent so we never send an empty header', () => {
    setCredentials({ keys: { anthropic: '    ' }, connected: {}, customBaseUrl: '', ollamaBaseUrl: '' });
    expect(getKey('anthropic')).toBeUndefined();
  });

  it('returns undefined for providers with no key', () => {
    expect(getKey('openrouter')).toBeUndefined();
  });
});

describe('requireKey', () => {
  it('returns the key when present', () => {
    setCredentials({ keys: { gemini: 'AIza-test' }, connected: {}, customBaseUrl: '', ollamaBaseUrl: '' });
    expect(requireKey('gemini', 'Gemini')).toBe('AIza-test');
  });

  it('throws a not_configured ProviderError when missing — no doomed request is sent', () => {
    let thrown: unknown;
    try {
      requireKey('gemini', 'Gemini', 'https://example.com/keys');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ProviderError);
    const err = thrown as ProviderError;
    expect(err.code).toBe('not_configured');
    expect(err.retryable).toBe(false);
    expect(err.action?.href).toBe('https://example.com/keys');
  });
});

describe('maskKey', () => {
  it('returns an empty string for no key', () => {
    expect(maskKey(undefined)).toBe('');
    expect(maskKey('')).toBe('');
    expect(maskKey('   ')).toBe('');
  });

  it('fully masks very short keys — no characters of the secret survive', () => {
    expect(maskKey('short')).toBe('•••••');
  });

  it('keeps only first 4 and last 4 of a long key', () => {
    const masked = maskKey('sk-abcdefghijklmnopqrstuv');
    expect(masked.startsWith('sk-a')).toBe(true);
    expect(masked.endsWith('stuv')).toBe(true);
    expect(masked).not.toContain('efghijklmno');
  });

  it('never leaks the middle of a realistic key', () => {
    const key = 'AIzaSyA-verysecretkeythatislongabcdef12345';
    const masked = maskKey(key);
    expect(masked).not.toContain('secretkey');
    expect(masked.length).toBeLessThan(key.length);
  });

  it('is stable and pure for the same input', () => {
    expect(maskKey('sk-abcdefghijklmnopqrstuv')).toBe(maskKey('sk-abcdefghijklmnopqrstuv'));
  });
});
