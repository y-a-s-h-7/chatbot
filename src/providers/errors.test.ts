import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProviderError,
  configError,
  fromResponse,
  isAbortError,
  isFriendly,
  networkError,
  toProviderError,
} from './errors';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fromResponse', () => {
  it('maps 401 to a non-retryable auth error', () => {
    const err = fromResponse(401, '', 'Gemini');
    expect(err.code).toBe('auth');
    expect(err.retryable).toBe(false);
    expect(err.message).toContain('Gemini');
    expect(err.status).toBe(401);
  });

  it('maps 403 to forbidden', () => {
    expect(fromResponse(403, '', 'Anthropic').code).toBe('forbidden');
  });

  it('maps 402 to quota, not retryable', () => {
    const err = fromResponse(402, '', 'OpenRouter');
    expect(err.code).toBe('quota');
    expect(err.retryable).toBe(false);
  });

  it('maps 404 to not_found', () => {
    expect(fromResponse(404, '', 'OpenRouter').code).toBe('not_found');
  });

  it('maps 429 to a retryable rate limit', () => {
    const err = fromResponse(429, '', 'Groq');
    expect(err.code).toBe('rate_limit');
    expect(err.retryable).toBe(true);
  });

  it('sees Google rejecting a key through a 400 body as auth, not bad_request', () => {
    const body = JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } });
    const err = fromResponse(400, body, 'Gemini');
    expect(err.code).toBe('auth');
    expect(err.retryable).toBe(false);
    // The key itself must never appear in the message, only the provider name.
    expect(err.message).toContain('Gemini');
  });

  it('maps a 400 mentioning context length to context_length', () => {
    const body = JSON.stringify({ error: { message: 'Input is too long for requested model' } });
    const err = fromResponse(400, body, 'Gemini');
    expect(err.code).toBe('context_length');
  });

  it('maps an ordinary 400 to bad_request and keeps a bounded upstream snippet', () => {
    const body = JSON.stringify({ error: { message: 'x'.repeat(500) } });
    const err = fromResponse(400, body, 'Custom');
    expect(err.code).toBe('bad_request');
    expect(err.message.length).toBeLessThan(300);
  });

  it('maps 5xx to a retryable server error', () => {
    const err = fromResponse(503, '', 'Anthropic');
    expect(err.code).toBe('server');
    expect(err.retryable).toBe(true);
  });

  it('reads a flat string error field from the body', () => {
    const err = fromResponse(400, JSON.stringify({ error: 'bad thing', message: 'ignored' }), 'Custom');
    expect(err.code).toBe('bad_request');
    expect(err.message).toContain('bad thing');
  });

  it('never echoes a raw non-JSON body back to the user', () => {
    const err = fromResponse(400, '<html>secret internals</html>', 'Custom');
    expect(err.code).toBe('bad_request');
    // bodyMessage() returns undefined for non-JSON, so no body text leaks
    expect(err.message).not.toContain('secret internals');
  });
});

describe('networkError', () => {
  it('mentions CORS when the browser is online', () => {
    vi.stubGlobal('navigator', { onLine: true });
    const err = networkError('Ollama');
    expect(err.code).toBe('network');
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('CORS');
    expect(err.message).toContain('Ollama');
  });

  it('says offline when navigator reports no connection', () => {
    vi.stubGlobal('navigator', { onLine: false });
    const err = networkError('Gemini');
    expect(err.message).toContain('offline');
    expect(err.message).not.toContain('CORS');
  });
});

describe('toProviderError', () => {
  it('passes ProviderError through untouched', () => {
    const original = new ProviderError('rate_limit', 'slow down');
    expect(toProviderError(original, 'X')).toBe(original);
  });

  it('classifies an AbortError as stopped and non-retryable', () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const err = toProviderError(abort, 'Gemini');
    expect(err.code).toBe('aborted');
    expect(err.retryable).toBe(false);
    expect(isAbortError(abort)).toBe(true);
  });

  it('classifies a fetch TypeError as a network error', () => {
    const err = toProviderError(new TypeError('Failed to fetch'), 'OpenRouter');
    expect(err.code).toBe('network');
    expect(err.retryable).toBe(true);
  });

  it('falls back to unknown but keeps the provider name', () => {
    const err = toProviderError(new Error('weird'), 'Groq');
    expect(err.code).toBe('unknown');
    expect(err.message).toContain('Groq');
  });

  it('bounds the message from arbitrary thrown values', () => {
    const err = toProviderError('y'.repeat(500), 'Groq');
    expect(err.message.length).toBeLessThan(300);
  });
});

describe('ProviderError defaults', () => {
  it('marks config errors non-retryable', () => {
    const err = configError('Set a base URL first', 'Custom');
    expect(err.code).toBe('not_configured');
    expect(err.retryable).toBe(false);
    expect(isFriendly(err)).toBe(true);
    expect(isFriendly(new Error('raw'))).toBe(false);
  });

  it('defaults retryable to false only for auth/forbidden/config problems', () => {
    expect(new ProviderError('rate_limit', 'x').retryable).toBe(true);
    expect(new ProviderError('server', 'x').retryable).toBe(true);
    expect(new ProviderError('auth', 'x').retryable).toBe(false);
    expect(new ProviderError('not_configured', 'x').retryable).toBe(false);
  });
});
