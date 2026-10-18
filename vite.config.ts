import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createNodeMiddleware } from './server/proxy.mjs';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Every origin the browser is allowed to reach. Adding a provider means adding
 * its API origin here (see README).
 */
const PROVIDER_ORIGINS = [
  'https://generativelanguage.googleapis.com',
  'https://api.anthropic.com',
  'https://openrouter.ai',
  'https://api.groq.com',
  'https://api.mistral.ai',
  'https://api.together.xyz',
  'https://api.openai.com',
  // Local runtimes people point the OpenAI-compatible adapter at.
  'http://localhost:*',
  'http://127.0.0.1:*',
  // WebLLM model weights.
  'https://huggingface.co',
  'https://*.huggingface.co',
  'https://*.hf.co',
  'https://cdn-lfs.huggingface.co',
  'https://raw.githubusercontent.com',
];

function inlineScriptHashes(html: string): string[] {
  const hashes: string[] = [];
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const body = match[1];
    if (!body.trim()) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/**
 * The CSP delivered in the document. frame-ancestors is deliberately absent: it
 * has no effect in a <meta> tag and the browser logs an error about it. It is
 * set as a real response header in public/_headers and vercel.json instead.
 */
function buildCsp(html: string): string {
  const hashes = inlineScriptHashes(html);
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${PROVIDER_ORIGINS.join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function devCsp(): string {
  // Dev needs Vite's HMR websocket, inline react-refresh preamble and eval'd
  // source maps. Production gets the strict policy below.
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ws: wss: ${PROVIDER_ORIGINS.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
}

function cspPlugin(): Plugin {
  return {
    name: 'chatbot:csp',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const isDev = Boolean(ctx.server);
        // Build only: drop the Google Fonts <link> when offline builds are needed.
        const content = isDev ? devCsp() : buildCsp(html);
        return {
          html,
          tags: [
            {
              tag: 'meta',
              attrs: { 'http-equiv': 'Content-Security-Policy', content },
              injectTo: 'head-prepend',
            },
          ],
        };
      },
    },
  };
}

function freeProxyPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'chatbot:free-proxy',
    configureServer(server) {
      server.middlewares.use(createNodeMiddleware(env));
    },
    // `npm run preview` serves the production build; without this the app would
    // 404 on /api/chat/health and log a console error that production never has.
    configurePreviewServer(server) {
      server.middlewares.use(createNodeMiddleware(env));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...process.env, ...loadEnv(mode, rootDir, '') } as Record<string, string>;
  return {
    // Relative asset URLs, so the very same `dist/` folder works from a web
    // server, from `file://`, and from the Electron `app://` scheme. Absolute
    // `/assets/...` paths break the moment the document is not served from a
    // site root, which is exactly what a desktop shell does.
    base: './',
    plugins: [react(), tailwindcss(), freeProxyPlugin(env), cspPlugin()],
    resolve: {
      alias: { '@': path.resolve(rootDir, 'src') },
    },
    esbuild: {
      legalComments: 'none',
    },
    optimizeDeps: {
      // Huge, only ever loaded on demand from the browser-model path.
      exclude: ['@mlc-ai/web-llm'],
    },
    build: {
      target: 'es2022',
      cssCodeSplit: true,
      sourcemap: false,
      chunkSizeWarningLimit: 1200,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            // The native shell SDKs are only ever reached through a dynamic
            // import, and only on a device that is running inside one. Forcing
            // them into `vendor` would put Capacitor in the first paint of the
            // web build, so they are left for Rollup to keep as async chunks.
            if (id.includes('@capacitor') || id.includes('@aparajita')) return;
            if (id.includes('@mlc-ai')) return 'webllm';
            if (id.includes('highlight.js')) return 'highlighter';
            if (id.includes('react-markdown') || id.includes('remark') || id.includes('micromark') || id.includes('mdast') || id.includes('hast')) {
              return 'markdown';
            }
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react';
            return 'vendor';
          },
        },
      },
    },
    server: {
      port: 5173,
      // Fail loudly instead of quietly moving to 5174. Browser storage — saved
      // chats, keys and the in-browser model cache — is keyed by origin, so a
      // silent port change looks like total data loss and forces a fresh
      // multi-hundred-megabyte model download.
      strictPort: true,
    },
    preview: {
      port: 4173,
    },
  };
});
