'use strict';

/**
 * The only bridge between the app and the main process.
 *
 * contextIsolation is on and nodeIntegration is off, so this file is the entire
 * attack surface: it exposes four narrow, purpose-built APIs and nothing else.
 * No key, no header and no response body is ever logged or reflected back into
 * the page except as the caller asked for it.
 *
 * Subscriptions hand back a numeric token instead of a function, because a
 * token is a primitive and crosses the context bridge unchanged, while a
 * returned function would have to be proxied.
 *
 * The OAuth flow uses a loopback redirect URI (`http://127.0.0.1:{port}`) on
 * Windows. The main process opens a free port on 127.0.0.1, gives the port to the
 * renderer through `electronLoopbackRedirect()`, and the renderer asks the browser
 * to open that URI. The browser's redirect arrives to the main process's listener,
 * which forwards it to the renderer over the 'oauth:redirect' IPC channel.
 */

const { contextBridge, ipcRenderer } = require('electron');

const httpListeners = new Map();
const redirectListeners = new Map();
let nextToken = 1;
let pendingRedirect = null;
let pendingLoopbackPort = null;

ipcRenderer.on('native:http:event', (_event, payload) => {
  for (const handler of httpListeners.values()) {
    try {
      handler(payload);
    } catch {
      /* ignore */
    }
  }
});

ipcRenderer.on('oauth:redirect', (_event, url) => {
  pendingRedirect = url;
  for (const handler of redirectListeners.values()) {
    try {
      handler(url);
    } catch {
      /* ignore */
    }
  }
});

ipcRenderer.on('oauth:loopback-port', (_event, port) => {
  pendingLoopbackPort = port;
});

contextBridge.exposeInMainWorld('chatbotNative', {
  shell: 'electron',
  version: process.versions.electron,
  platform: process.platform,
  redirectUri: 'chatbot://oauth/callback',

  http: {
    start(request) {
      ipcRenderer.send('native:http:start', request);
    },
    abort(id) {
      ipcRenderer.send('native:http:abort', id);
    },
    subscribe(handler) {
      const token = nextToken++;
      httpListeners.set(token, handler);
      return token;
    },
    unsubscribe(token) {
      httpListeners.delete(token);
    },
  },

  secureStorage: {
    available: () => ipcRenderer.invoke('secrets:available'),
    get: (key) => ipcRenderer.invoke('secrets:get', key),
    set: (key, value) => ipcRenderer.invoke('secrets:set', key, value),
    remove: (key) => ipcRenderer.invoke('secrets:remove', key),
  },

  oauth: {
    open(url) {
      return ipcRenderer.invoke('oauth:open', url);
    },
    subscribeRedirect(handler) {
      const token = nextToken++;
      redirectListeners.set(token, handler);
      if (pendingRedirect) {
        const url = pendingRedirect;
        pendingRedirect = null;
        setTimeout(() => handler(url), 0);
      }
      return token;
    },
    unsubscribeRedirect(token) {
      redirectListeners.delete(token);
    },
    async electronLoopbackRedirect() {
      // The main process opens the loopback listener when the window is ready,
      // and tells the renderer the chosen port. Until then there is no loopback
      // URI, and the bridge reports 'undefined' so the UI can fall back to the
      // custom scheme.
      if (pendingLoopbackPort != null) return `http://127.0.0.1:${pendingLoopbackPort}`;
      if (typeof ipcRenderer.invoke === 'function') {
        try {
          const port = await ipcRenderer.invoke('oauth:loopback-port');
          return port != null ? `http://127.0.0.1:${port}` : undefined;
        } catch (e) {
          return undefined;
        }
      }
      return undefined;
    },
  },

  info() {
    return ipcRenderer.invoke('app:info');
  },
});
