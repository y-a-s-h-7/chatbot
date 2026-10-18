import { describe, expect, it } from 'vitest';
import { parseOAuthRedirect } from './deeplink';

describe('parseOAuthRedirect', () => {
  it('reads the code and state from a web callback URL', () => {
    const redirect = parseOAuthRedirect('https://example.com/app/?code=abc123&state=xyz');
    expect(redirect.code).toBe('abc123');
    expect(redirect.state).toBe('xyz');
    expect(redirect.error).toBeNull();
  });

  it('reads a deep link from the desktop or Android shell', () => {
    const redirect = parseOAuthRedirect('chatbot://oauth/callback?code=abc123&state=xyz');
    expect(redirect.code).toBe('abc123');
    expect(redirect.state).toBe('xyz');
  });

  it('reads a bare query string', () => {
    expect(parseOAuthRedirect('?code=abc123').code).toBe('abc123');
  });

  it('ignores the fragment when the query already answers', () => {
    const redirect = parseOAuthRedirect('https://example.com/?code=abc#/chat');
    expect(redirect.code).toBe('abc');
  });

  it('falls back to the fragment when the query is empty', () => {
    const redirect = parseOAuthRedirect('https://example.com/#?code=abc');
    expect(redirect.code).toBe('abc');
  });

  it('surfaces a refusal instead of pretending a code arrived', () => {
    const redirect = parseOAuthRedirect('chatbot://oauth/callback?error=access_denied&error_description=User%20said%20no');
    expect(redirect.code).toBeNull();
    expect(redirect.error).toBe('access_denied');
    expect(redirect.description).toBe('User said no');
  });

  it('returns an empty result rather than throwing on junk', () => {
    const redirect = parseOAuthRedirect('%%%not a url%%%');
    expect(redirect.code).toBeNull();
    expect(redirect.error).toBeNull();
  });

  it('does not mistake an unrelated query for a callback', () => {
    const redirect = parseOAuthRedirect('https://example.com/?utm_source=newsletter');
    expect(redirect.code).toBeNull();
    expect(redirect.state).toBeNull();
  });
});
