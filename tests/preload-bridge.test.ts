import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => void;

interface ExposedApiOauth {
  open(url: string): Promise<unknown>;
  subscribeRedirect(handler: (url: string) => void): number;
  unsubscribeRedirect(token: number): void;
  electronLoopbackRedirect(): Promise<string | undefined>;
}

interface ExposedApiHttp {
  start(request: unknown): void;
  abort(id: string): void;
  subscribe(handler: (event: unknown) => void): number;
  unsubscribe(token: number): void;
}

interface ExposedApi {
  shell: string;
  redirectUri: string;
  http: ExposedApiHttp;
  secureStorage: {
    available(): Promise<unknown>;
    get(key: string): Promise<unknown>;
    set(key: string, value: string): Promise<unknown>;
    remove(key: string): Promise<unknown>;
  };
  oauth: ExposedApiOauth;
  info(): Promise<unknown>;
}

function loadBridge(pendingLoopbackPort?: number) {
  const source = readFileSync(resolve(process.cwd(), 'electron', 'preload.cjs'), 'utf8');
  const listeners = new Map<string, Handler[]>();
  const sent: Array<{ channel: string; args: unknown[] }> = [];
  const invoked: Array<{ channel: string; args: unknown[] }> = [];
  let pendingLoopbackPort_ = pendingLoopbackPort;

  const fakeElectron = {
    contextBridge: {
      exposeInMainWorld: (name: string, api: ExposedApi) => {
        invoked.push({ channel: 'contextBridge:exposeInMainWorld', args: [name, api] });
      },
    },
    ipcRenderer: {
      on: (channel: string, handler: Handler) => {
        listeners.set(channel, [...(listeners.get(channel) ?? []), handler]);
      },
      send: (channel: string, ...args: unknown[]) => {
        sent.push({ channel, args });
      },
      invoke: async (channel: string, ...args: unknown[]) => {
        invoked.push({ channel, args });
        const channelStr = channel as string;
        if (channelStr === 'oauth:loopback-port') {
          return pendingLoopbackPort_ ?? undefined;
        }
        return { channel, args };
      },
    },
  };

  const moduleShim = { exports: {} as Record<string, unknown> };
  const fakeRequire = (id: string) => {
    if (id === 'electron') return fakeElectron;
    throw new Error(`Unexpected require("${id}") in the preload script`);
  };
  // eslint-disable-next-line no-new-func
  new Function('require', 'module', 'exports', source)(fakeRequire, moduleShim, moduleShim.exports);

  const emit = (channel: string, ...args: unknown[]) => {
    for (const handler of listeners.get(channel) ?? []) handler({ sender: 'main' }, ...args);
  };
  const exposure: ExposedApi | undefined = (moduleShim.exports as any)['default'] ?? (moduleShim.exports?.['renderer']) ? (moduleShim.exports['renderer'] as () => ExposedApi | undefined)?.() : undefined;
  return {
    bridge: exposure,
    emit,
    invoked: () => invoked,
  };
}

function makeBridge() {
  const { bridge, emit, invoked } = loadBridge(59132);
  return { bridge, emit, invoked: () => invoked() };
}

describe('preload-bridge', () => {
  const bridge = makeBridge();

  function exposedApi() {
    const entry = bridge.invoked().find((e) => e.channel === 'contextBridge:exposeInMainWorld');
    if (!entry) throw new Error('contextBridge:exposeInMainWorld not invoked');
    const api = entry.args?.[1];
    if (!api) throw new Error('preload did not expose the bridge');
    return api as ExposedApi;
  }

  it('does not expose electronLoopbackRedirect until the main process has opened the listener', async () => {
    const withoutPort = loadBridge();
    const api = exposedApiFrom(withoutPort);
    expect(api).toBeDefined();
    const redirect = await api.oauth.electronLoopbackRedirect();
    expect(redirect).toBeUndefined();
  });

  function exposedApiFrom(bridge: ReturnType<typeof loadBridge>): ExposedApi {
    const entry = bridge.invoked().find((e) => e.channel === 'contextBridge:exposeInMainWorld');
    if (!entry) throw new Error('contextBridge:exposeInMainWorld not invoked');
    const api = entry.args?.[1];
    if (!api) throw new Error('preload did not expose the bridge');
    return api as ExposedApi;
  }

  it('returns the loopback URI once the main process has opened the listener', async () => {
    const withPort = loadBridge(59132);
    const api = exposedApiFrom(withPort!);
    const redirect = await api.oauth.electronLoopbackRedirect();
    expect(redirect).toBe('http://127.0.0.1:59132');
  });

  describe('eventHandling', () => {
    describe('httpSubscribe', () => {
      const bridge = makeBridge();

      it('routes incoming events onto every subscriber', () => {
        const api = exposedApiFrom(bridge);
        const received: unknown[] = [];
        api.http.subscribe((event) => received.push(event));
        bridge.emit('native:http:event', { id: 'r1', type: 'chunk', chunk: new Uint8Array([1]) });
        expect(received).toHaveLength(1);
      });

      it('keeps one broken subscriber from starving the others', () => {
        const api = exposedApiFrom(bridge);
        const blowUp = () => { throw new Error('boom'); };
        const received: unknown[] = [];
        api.http.subscribe(blowUp);
        api.http.subscribe((event) => received.push(event));
        bridge.emit('native:http:event', { id: 'r1', type: 'chunk', chunk: new Uint8Array([1]) });
        expect(received).toHaveLength(1);
      });
    });
  });

  it('maps secrets onto the main-process handlers', async () => {
    const api = exposedApi();
    await api.secureStorage.available();
    await api.secureStorage.get('provider-keys');
    await api.secureStorage.set('provider-keys', '{"v":1}');
    await api.secureStorage.remove('provider-keys');
    const channels = bridge.invoked().slice(1).map((entry) => entry.channel);
expect(channels).toEqual([
      'secrets:available',
      'secrets:get',
      'secrets:set',
      'secrets:remove',
    ]);
  });

  it('opens the system browser through the main process', async () => {
    const api = exposedApi();
    await api.oauth.open('https://openrouter.ai/auth');
    const last = bridge.invoked().at(-1);
    expect(last?.channel).toBe('oauth:open');
    expect(last?.args).toEqual(['https://openrouter.ai/auth']);
  });
});
