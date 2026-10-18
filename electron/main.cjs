'use strict';

/**
 * The desktop shell around the same `dist/` folder the web build produces.
 *
 * Three things make it worth having beyond a window wrapper:
 *
 *  1. The renderer is served from a privileged `app://` scheme rather than
 *     `file://`, so it has a real origin. Chromium refuses IndexedDB on file://
 *     origins, and without IndexedDB the app would lose both its chats and its
 *     multi-hundred-megabyte model cache.
 *  2. Provider calls go through the main process instead of the page. There is
 *     no CORS to satisfy, the system proxy is honoured, and responses stream
 *     back chunk by chunk over IPC rather than piling up in memory.
 *  3. API keys go into `safeStorage` (DPAPI on Windows), which is the only place
 *     on a desktop machine where a key is actually protected.
 *
 * The OpenRouter OAuth callback, on Windows, uses a loopback redirect URI
 * (`http://127.0.0.1:{port}`) instead of a custom scheme. The main process opens
 * a free port on 127.0.0.1 before the browser is opened, gives the port to the
 * renderer, and receives the browser's redirect there. The renderer never guesses
 * a port that might already be in use.
 */

const { app, BrowserWindow, ipcMain, net, protocol, safeStorage, screen, session, shell } = require('electron');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL, URL } = require('node:url');
const { createWindowState } = require('./lib/window-state.cjs');

const APP_SCHEME = 'app';
const APP_HOST = 'chatbot';
const DEEP_LINK_SCHEME = 'chatbot';
const RENDERER_DIR = path.join(__dirname, '..', 'dist');
const DEV_SERVER_URL = process.env.CHATBOT_DEV_SERVER_URL || 'http://localhost:5173';
const IS_DEV = !app.isPackaged;

/**
 * OpenRouter documents `http://localhost` and `http://127.0.0.1` as redirect
 * URIs. A custom scheme may also work, but we reach for the documented one.
 */
const OAUTH_LOCALHOST = 'http://127.0.0.1';
let loopbackServer = null;
let loopbackPort = 0;

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true, codeCache: true },
  },
]);

// One window only: a second launch (or a deep link) hands over to the first.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    const link = argv.find((arg) => typeof arg === 'string' && arg.startsWith(`${DEEP_LINK_SCHEME}://`));
    if (link) deliverRedirect(link);
    focusMainWindow();
  });

  // macOS and, on Windows/Linux, the protocol handler.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    deliverRedirect(url);
  });

  app.whenReady().then(onReady);
}

let mainWindow = null;
let windowState = null;

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function deliverRedirect(url) {
  focusMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('oauth:redirect', url);
}

// ---------------------------------------------------------------------------
// A free loopback port on 127.0.0.1, chosen by the main process and exposed to
// the renderer. The renderer asks for it through `electronLoopbackRedirect()`.
// ---------------------------------------------------------------------------

function startLoopbackListener() {
  if (loopbackServer) return;
  try {
    const server = http.createServer((req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Connection': 'close',
      });
      res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Authentication Successful</title></head>
<body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #f8fafc;">
  <div style="text-align: center; padding: 2rem; background: #1e293b; border-radius: 12px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
    <h2 style="margin-top: 0; color: #38bdf8;">Authentication Successful</h2>
    <p style="color: #94a3b8;">You can close this tab and return to the Chatbot application.</p>
  </div>
  <script>setTimeout(() => window.close(), 1500);</script>
</body>
</html>`);

      const target = `http://127.0.0.1:${loopbackPort}${req.url || ''}`;
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('oauth:redirect', target);
        focusMainWindow();
      }
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') {
        loopbackPort = address.port;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('oauth:loopback-port', loopbackPort);
        }
      }
    });

    server.on('error', (err) => {
      console.warn('Loopback server error:', err);
      closeLoopbackListener();
    });

    loopbackServer = server;
  } catch (err) {
    console.warn('Could not start loopback listener:', err);
  }
}

function closeLoopbackListener() {
  if (loopbackServer) {
    try {
      loopbackServer.close();
    } catch {
      /* ignore */
    }
    loopbackServer = null;
  }
  loopbackPort = 0;
}

// ---------------------------------------------------------------------------
// Renderer files over app://
// ---------------------------------------------------------------------------

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    let relative = 'index.html';
    try {
      const { pathname } = new URL(request.url);
      const decoded = decodeURIComponent(pathname).replace(/^\/+/, '');
      if (decoded) relative = decoded;
    } catch {
      /* malformed URL: fall through to the shell */
    }

    const target = path.resolve(RENDERER_DIR, relative);
    // Never read outside the build directory, whatever the URL claims.
    if (!target.startsWith(RENDERER_DIR)) return new Response('Not found', { status: 404 });

    try {
      return await net.fetch(pathToFileURL(target).toString(), { bypassCustomProtocolHandlers: true });
    } catch {
      try {
        return await net.fetch(pathToFileURL(path.join(RENDERER_DIR, 'index.html')).toString(), {
          bypassCustomProtocolHandlers: true,
        });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    }
  });
}

function createWindow() {
  const bounds = windowState.restore();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 420,
    minHeight: 520,
    show: false,
    title: 'Chatbot',
    backgroundColor: '#0b0b0d',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: true,
    },
  });

  windowState.track(win);
  if (bounds.maximized) win.maximize();

  win.once('ready-to-show', () => win.show());
  mainWindow = win;
  win.on('closed', () => {
    mainWindow = null;
  });

  const target = IS_DEV ? DEV_SERVER_URL : `${APP_SCHEME}://${APP_HOST}/index.html`;
  void win.loadURL(target);
  if (IS_DEV && process.env.CHATBOT_DEVTOOLS === '1') win.webContents.openDevTools({ mode: 'detach' });

  return win;
}

// ---------------------------------------------------------------------------
// Chromium-level hardening
// ---------------------------------------------------------------------------

function hardenWebContents() {
  app.on('web-contents-created', (_event, contents) => {
    // Anything that wants a new window opens in the user's browser instead.
    contents.setWindowOpenHandler(({ url }) => {
      void openExternalSafely(url);
      return { action: 'deny' };
    });

    contents.on('will-navigate', (event, url) => {
      const allowed = url.startsWith(`${APP_SCHEME}://`) || (IS_DEV && url.startsWith(DEV_SERVER_URL));
      if (allowed) return;
      event.preventDefault();
      void openExternalSafely(url);
    });
  });
}

async function openExternalSafely(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    return false;
  }
  // Only ever hand http(s) to the operating system: a `file:` or `javascript:`
  // URL reaching shell.openExternal is a local code execution primitive.
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  await shell.openExternal(parsed.toString());
  return true;
}

function allowModelWeightDownloads() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    let host = '';
    try {
      host = new URL(details.url).host;
    } catch {
      host = '';
    }
    const isWeightHost = WEIGHT_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
    if (!isWeightHost) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    const headers = { ...(details.responseHeaders ?? {}) };
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'access-control-allow-origin')) {
      headers['Access-Control-Allow-Origin'] = ['*'];
    }
    callback({ responseHeaders: headers });
  });
}

// ---------------------------------------------------------------------------
// Streaming HTTP for the renderer
// ---------------------------------------------------------------------------

/** id -> { abort, reader } for every request currently in flight. */
const inFlight = new Map();

function safeMessage(error) {
  const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : String(error);
  // Never echo anything that looks like a credential back into the page.
  return message.replace(/\b(sk-[A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{6,}|Bearer\s+\S+)/g, '[redacted]').slice(0, 300);
}

function registerHttpBridge() {
  ipcMain.on('native:http:start', (event, payload) => {
    if (!payload || typeof payload.id !== 'string' || typeof payload.url !== 'string') return;
    const sender = event.sender;
    const { id, url, method = 'POST', headers = {}, body } = payload;

    const controller = new AbortController();
    const state = { controller, reader: null };
    inFlight.set(id, state);

    const send = (message) => {
      if (sender.isDestroyed()) return;
      sender.send('native:http:event', { id, ...message });
    };

    void (async () => {
      try {
        const response = await net.fetch(url, {
          method,
          headers,
          ...(method === 'GET' || method === 'HEAD' || body === undefined ? {} : { body }),
          signal: controller.signal,
          redirect: 'follow',
        });

        const responseHeaders = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        send({
          type: 'meta',
          status: response.status,
          statusText: response.statusText,
          headers: responseHeaders,
          hasBody: Boolean(response.body),
        });

        if (!response.body) {
          send({ type: 'end' });
          return;
        }

        const reader = response.body.getReader();
        state.reader = reader;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.byteLength) send({ type: 'chunk', chunk: value });
        }
        send({ type: 'end' });
      } catch (error) {
        const aborted = controller.signal.aborted || (error && error.name === 'AbortError');
        send({ type: 'error', message: aborted ? 'The request was stopped.' : safeMessage(error) });
      } finally {
        inFlight.delete(id);
      }
    })();
  });

  ipcMain.on('native:http:abort', (_event, id) => {
    const state = inFlight.get(id);
    if (!state) return;
    inFlight.delete(id);
    try {
      state.controller.abort();
    } catch {
      /* already gone */
    }
    // Cancelling the body is what actually closes the socket when the provider
    // has already sent its headers.
    void state.reader?.cancel?.().catch(() => {});
  });
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

let secretsCache = null;

function secretsPath() {
  return path.join(app.getPath('userData'), 'secrets.json');
}

function encryptionAvailable() {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function readSecrets() {
  if (secretsCache) return secretsCache;
  try {
    const parsed = JSON.parse(fs.readFileSync(secretsPath(), 'utf8'));
    secretsCache = parsed && parsed.v === 1 && parsed.entries ? parsed : { v: 1, entries: {} };
  } catch {
    secretsCache = { v: 1, entries: {} };
  }
  return secretsCache;
}

function writeSecrets() {
  try {
    fs.mkdirSync(path.dirname(secretsPath()), { recursive: true });
    // 0600: on the platforms where these bytes are readable at all, only this
    // user should be the one reading them.
    fs.writeFileSync(secretsPath(), JSON.stringify(secretsCache), { encoding: 'utf8', mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function registerSecretBridge() {
  ipcMain.handle('secrets:available', () => encryptionAvailable());

  ipcMain.handle('secrets:get', (_event, key) => {
    if (!encryptionAvailable() || typeof key !== 'string') return null;
    const entry = readSecrets().entries[key];
    if (typeof entry !== 'string') return null;
    try {
      return safeStorage.decryptString(Buffer.from(entry, 'base64'));
    } catch {
      // A blob encrypted under a different OS user or a rotated key: drop it
      // rather than returning something unusable.
      delete readSecrets().entries[key];
      writeSecrets();
      return null;
    }
  });

  ipcMain.handle('secrets:set', (_event, key, value) => {
    if (typeof key !== 'string' || typeof value !== 'string') return false;
    if (!encryptionAvailable()) return false;
    try {
      readSecrets().entries[key] = safeStorage.encryptString(value).toString('base64');
      return writeSecrets();
    } catch {
      return false;
    }
  });

  ipcMain.handle('secrets:remove', (_event, key) => {
    if (typeof key !== 'string') return false;
    delete readSecrets().entries[key];
    return writeSecrets();
  });
}

// ---------------------------------------------------------------------------
// Wiring: deep links, HTTP bridge, secrets, OAuth, loopback listener.
// ---------------------------------------------------------------------------

function registerOAuthBridge() {
  ipcMain.handle('oauth:open', async (_event, url) => openExternalSafely(url));
  ipcMain.handle('app:info', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  }));

  // When the renderer asks for the loopback redirect URI, pick a port now if we
  // have not already, and tell the renderer the chosen port.
  ipcMain.handle('oauth:loopback-port', async () => {
    if (!loopbackPort) {
      startLoopbackListener();
    }
    return loopbackPort || undefined;
  });

  // The renderer sends us a request to open the browser with the loopback
  // redirect URI; we open the browser and forward the response to the renderer.
  ipcMain.handle('oauth:open-loopback', async (_event, redirectUri) => {
    if (!redirectUri || !redirectUri.startsWith(OAUTH_LOCALHOST)) return false;
    await openExternalSafely(redirectUri);
    // The browser's redirect will arrive to the loopback listener; we do not need
    // to do anything here. The listener forwards to the renderer.
    return true;
  });
}

function registerDeepLinkProtocol() {
  if (process.defaultApp && process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }
}

function onReady() {
  app.setAppUserModelId('com.yash7.chatbot');
  windowState = createWindowState(path.join(app.getPath('userData'), 'window-state.json'), screen);

  registerAppProtocol();
  registerDeepLinkProtocol();
  registerHttpBridge();
  registerSecretBridge();
  registerOAuthBridge();

  createWindow();
  startLoopbackListener();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

app.on('window-all-closed', () => {
  closeLoopbackListener();
  if (process.platform !== 'darwin') app.quit();
});
