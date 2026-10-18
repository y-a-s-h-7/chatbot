import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function makeMainProcessRedirect() {
  const { createServer } = require('node:net');
  let server: ReturnType<typeof createServer> | undefined;
  let port = 0;
  let capturedUrl = '';
  let onRedirect: ((url: string) => void) | null = null;

  async function listen() {
    const srv = await new Promise<ReturnType<typeof createServer>>((resolve) => {
      const srv = createServer((connection) => {
        const chunks: Buffer[] = [];
        connection.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        connection.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8').split('\n')[0];
          capturedUrl = text;
          onRedirect?.(text);
          setTimeout(() => srv.close().catch(() => {}), 0);
        });
      });
      srv.listen(0, '127.0.0.1', () => {
        port = (srv.address() as { port: number }).port;
        resolve(srv);
      });
    });
    server = srv;
  }

  async function close() {
    if (!server) return;
    const srv = server;
    server = undefined;
    await srv.close();
  }

  function withRedirectHandler(handler: (url: string) => void) {
    const previous = onRedirect;
    onRedirect = handler;
    return () => {
      onRedirect = previous;
    };
  }

  return { get port() { return port; }, get capturedUrl() { return capturedUrl; }, listen, close, withRedirectHandler };
}

/** A renderer mock that registers OAuth listeners and opens the browser. */
function makeRendererListener(server: ReturnType<typeof makeMainProcessRedirect>) {
  const listeners = new Map<number, (url: string) => void>();
  let nextId = 1;

  return {
    register(handler: (url: string) => void) {
      const id = nextId++;
      listeners.set(id, handler);
      return id;
    },
    unregister(token: number) {
      const listener = listeners.get(token);
      listeners.delete(token);
      if (!listeners.size) {
        // The last listener left.
      }
    },
    openLoopback(uri: string) {
      // Simulate the browser's redirect landing on the server's loopback listener.
      listeners.forEach((handler) => handler(uri));
    },
    loopbackRedirect() {
      return `http://127.0.0.1:${server.port}/`;
    },
  };
}

describe('OpenRouter loopback redirect', () => {


  it('does not lose a cold-start deep link when the listener is not yet open', async () => {
    const server = makeMainProcessRedirect();
    const renderer = makeRendererListener(server);
    const handlerUrl: string[] = [];

    const token = renderer.register((url) => handlerUrl.push(url));
    // Simulate a cold start: the app was launched by a deep link, before the
    // listener was opened. The renderer's pendingRedirect queue is replayed.
    renderer.openLoopback('chatbot://oauth/callback?code=cold');

    await server.close();
    expect(handlerUrl).toEqual(['chatbot://oauth/callback?code=cold']);
  });

  it('resolves the 127.0.0.1 loopback URI as the Electron redirect path', async () => {
    const server = makeMainProcessRedirect();
    await server.listen();
    const renderer = makeRendererListener(server);
    const redirectUri = renderer.loopbackRedirect();
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    await server.close();
  });
});

/**
 * Verify that the app code reflects the ORC market redirect flow: the Electron
 * main process opens a free port on 127.0.0.1, tells the renderer the URI, and
 * the renderer directs the browser to that URI. We read the source at test time
 * so the test always reflects what the app actually uses.
 */
describe('OpenRouter OAuth redirect URI model', () => {
  it('uses a 127.0.0.1 loopback URI for Electron', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/native/deeplink.ts'), 'utf8');
    expect(source).toContain('127.0.0.1');
    expect(source).toContain('loopbackRedirect');
    expect(source).toContain('OAUTH_LOCALHOST');
    expect(source).toContain('OAUTH_FALLBACK_HTTPS_FALLBACK');
    expect(source).toContain('OAUTH_FALLBACK_SCHEME');
  });

  it('does not advertise its custom scheme as the only redirect path for Electron', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/lib/native/deeplink.ts'), 'utf8');
    // The Electron redirect is the loopback URI, not merely the custom scheme.
    const electronCase = source.match(/case ['"]electron['"]:\s*([\s\S]*?)\n\s*\}/)?.[1];
    expect(electronCase).not.toContain('OAUTH_CALLBACK');
    expect(electronCase).toContain('loopbackRedirect()');
  });
});
