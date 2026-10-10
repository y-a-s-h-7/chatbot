# Chatbot

A fast, calm chat app for simple input → output work: questions, rewriting,
summarising, translating, explaining code. It talks to LLM providers **directly
from your browser** — there is no backend holding your keys, and no account to
create before your first message.

```bash
npm install
npm run dev
```

Open http://localhost:5173. That is the whole setup.

---

## What you get

| | |
| --- | --- |
| **Zero setup** | A model that runs inside your browser (WebLLM + WebGPU), or a rate-limited free tier if the deployment hosts one. No login, no key. |
| **Bring your own key** | Paste a key per provider in Settings → Providers. There is a *Test key* button, a link to where you get one, and a *Remember on this device* switch. |
| **One-click connect** | OpenRouter via OAuth PKCE. Providers whose consumer plans do not include API access say "use an API key instead" — no fake Connect button anywhere. |
| **Honest model picker** | `⌘/Ctrl + K`. Grouped by provider, searchable, keyboard-navigable, badged **Free / Key needed / Connected**. Picking a model that needs a key opens the key dialog inline instead of failing. |
| **Streaming you can stop** | Tokens are batched per animation frame, so the UI stays at 60fps. Stop, regenerate, edit & resend, copy, delete. |
| **Local-first** | Conversations in IndexedDB, preferences in localStorage. Reload restores instantly. Nothing is uploaded except the prompt itself, to the provider you chose. |
| **Polished** | Light/dark/system, markdown with lazily-loaded syntax highlighting, virtualized long chats, a soft aura that breathes while the model streams, full keyboard access, and a strict CSP. |

---

## The three access modes, and how honest each one is

1. **Free, no account.** Two ways, both labelled clearly:
   - *This browser* — a small open model (Llama 3.2 1B, Qwen2.5 1.5B/3B) running on your
     GPU through WebLLM. Needs WebGPU (Chrome/Edge 113+ on desktop) and a one-time
     download of roughly 0.7–1.8 GB. Weights are cached by the browser afterwards.
     Nothing leaves the device.
   - *Free tier (shared)* — a rate-limited free model served by whoever deployed this
     app. See [The free tier](#the-free-tier). If the deployment has no server key, the
     badge says **Not deployed** rather than pretending.
2. **Bring your own key.** Google Gemini, Anthropic Claude, OpenRouter, Groq, Mistral,
   Together, and anything OpenAI-compatible including local Ollama and a custom base URL.
3. **Connect an account.** OpenRouter only, because it is the only one of these that
   genuinely supports OAuth for API access from a browser. Gemini and Claude show an
   explanation instead: signing in with Google does not grant Generative Language API
   access, and a Claude Pro/Max subscription does not include Claude API access.

Every request goes browser → provider. The app never sees your key.

---

## The free tier

The optional stateless proxy gives keyless users a small slice of a free-tier model,
and it is the only server-side code in the project. It:

- picks the upstream model **server-side**, so a client cannot ask for an expensive one;
- rate limits per IP (`FREE_PROXY_RPM`, `FREE_PROXY_RPD`, in memory);
- trims oversized payloads before forwarding;
- **never logs** prompts, completions or keys — there is no logging code at all;
- stores nothing.

Enable it by copying `.env.example` to `.env` and setting a server-side key:

```bash
cp .env.example .env
# then set OPENROUTER_API_KEY=...  (or GEMINI_API_KEY=... with FREE_PROXY_PROVIDER=gemini)
npm run dev
```

`npm run dev` mounts the same handler as a Vite middleware, so the free tier works
locally without a second process. In production it runs as an edge function:

- Vercel: `api/chat.ts` is picked up automatically.
- Netlify/Cloudflare: mount `handleProxy` from `server/proxy.mjs` at `/api/chat`.

Set `VITE_FREE_PROXY_URL` to the deployed URL if the app and the function live on
different origins. Leave everything empty and the app simply reports the free tier as
unavailable.

---

## Adding a model

One entry in **[src/providers/models.ts](src/providers/models.ts)**. Nothing in the UI
hardcodes a model ID.

```ts
{
  id: 'gemini-3.8-flash',        // exact ID sent to the provider
  provider: 'gemini',            // key into the provider registry
  label: 'Gemini 3.8 Flash',     // what the picker shows
  accessMode: 'needs-key',       // 'free-default' | 'needs-key' | 'oauth'
  contextWindow: 1048576,
  maxOutput: 65536,
  tags: ['balanced', 'vision'],  // used for search and the row subtitle
  notes: 'Good default for everyday chat.',   // shown in the picker footer
  requires: 'webgpu',            // optional runtime gate: 'webgpu' | 'free-proxy'
  recommended: true,             // optional; used when picking a default
  retired: false,                // set true to hide without deleting
}
```

Providers that expose `GET /models` (Gemini, Anthropic, OpenRouter, Groq, Mistral,
Together, Ollama, custom) also report their live catalogue, which the picker merges in
marked *Discovered live from the provider*. Curated entries win on conflicts.

## Adding a provider

1. Add a row to **[src/providers/providers.ts](src/providers/providers.ts)**:

   ```ts
   myprovider: {
     id: 'myprovider',
     name: 'My Provider',
     kind: 'openai-compatible',        // 'openai-compatible' covers most APIs
     blurb: 'One line for the Settings card.',
     baseUrl: 'https://api.myprovider.com/v1',
     keyUrl: 'https://myprovider.com/keys',
     docsUrl: 'https://myprovider.com/docs',
     corsSafe: true,
     connect: { supported: false, reason: 'API access comes from a dashboard key.' },
   }
   ```

2. If it speaks the OpenAI chat-completions dialect, that is already enough — add its
   ID to `ProviderId` and to the `switch` in **[src/providers/index.ts](src/providers/index.ts)**.
3. If it needs its own request shape, write an adapter next to
   **[src/providers/anthropic.ts](src/providers/anthropic.ts)**: implement
   `ChatProvider` (`id`, `name`, `listModels()`, `stream()`, `test()`), reuse
   `iterateSSE` / `openStream` / `toProviderError` from `transport.ts` and `errors.ts`,
   and map failures onto a `ProviderError` with a human sentence.
4. Add its origin to `PROVIDER_ORIGINS` in **[vite.config.ts](vite.config.ts)** — that
   list feeds the production CSP, and `public/_headers` / `vercel.json` mirror it.
5. Add its models to the registry (or rely on live discovery).

## Architecture

```
src/
  providers/            the interesting half of the app
    types.ts            ChatProvider, StreamEvent, ModelInfo — one interface
    providers.ts        endpoints, auth metadata, honest "can I connect?" answers
    models.ts           the editable model registry
    index.ts            provider resolution, availability, free-tier probe
    transport.ts        SSE reader, OpenAI chunk decoding, HTTP error translation
    errors.ts           ProviderError + the human wording for every failure
    messages.ts         conversation normalisation (system prompt, alternation)
    gemini.ts           streamGenerateContent (alt=sse)
    anthropic.ts        Messages API + anthropic-dangerous-direct-browser-access
    openai-compat.ts    OpenRouter, Groq, Mistral, Together, Ollama, custom, proxy
    webllm.ts           in-browser model, lazily imported, with load progress
  store/
    chatStore.ts        conversations, streaming pipeline, persistence
    liveStore.ts        in-flight tokens, deliberately outside the message tree
    modelStore.ts       catalog, live discovery, best available default
    settingsStore.ts    preferences + key storage policy
    toastStore.ts       toasts
  lib/
    credentials.ts      the only place adapters read keys from
    storage.ts          IndexedDB with a memory fallback
    streamBuffer.ts     rAF token batcher (+ timeout safety net) and coalescer
    highlighter.ts      lazy highlight.js grammars
    oauth.ts            OpenRouter PKCE
  components/           layout, chat, settings, markdown, ui primitives
server/proxy.mjs        the stateless free-tier proxy (used by api/chat.ts too)
scripts/mock-provider.mjs   local OpenAI-compatible mock for testing
```

**The one interface everything depends on** ([types.ts](src/providers/types.ts)):

```ts
interface ChatProvider {
  id: ProviderId
  name: string
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>
  stream(messages: ProviderMessage[], opts: StreamOptions, signal: AbortSignal): AsyncGenerator<StreamEvent>
  test(signal?: AbortSignal): Promise<{ detail: string }>   // cheapest possible call
}
```

`StreamEvent` is `status | delta | usage | done`, so progress reporting (a WebLLM
download, a provider note) uses the same channel as tokens without special cases.

**Why it stays smooth:** streaming text lives in its own store, so only the streaming
bubble and the scroll driver re-render; flushes are coalesced to one per animation
frame; messages are memoized; markdown, the syntax highlighter and the WebLLM runtime
are all lazy chunks; conversations render virtualized past 40 messages; auto-scroll
coalesces its writes and stops the moment you scroll up.

Initial payload is about **135 kB gzipped** (React, app code, CSS). Markdown (33 kB),
highlight.js (51 kB) and WebLLM (2.1 MB, only on the in-browser model path) load later.

---

## Privacy

- Keys live in memory by default. They are written to `localStorage` **only** if you
  switch on *Remember on this device* for that provider. Settings says so in plain
  words, and shows a masked form of the stored key.
- Keys are sent only to the provider that issued them, in the request header that
  provider expects.
- Conversations and messages stay in IndexedDB on this device.
- No analytics, no telemetry, no error reporting, no third-party scripts. The only
  external requests are provider APIs, the WebLLM weight CDN, and Google Fonts
  (remove the `<link>` in `index.html` for a fully offline-ui build).
- Strict CSP (in `vite.config.ts`, mirrored in `public/_headers` and `vercel.json`),
  `nosniff`, `frame-ancestors 'none'`, and a restrictive `Permissions-Policy`.
- **Clear all data** in Settings → Data & privacy removes conversations, keys,
  preferences and the cached browser-model weights.

---

## Testing

```bash
npm run mock        # a local OpenAI-compatible provider on 127.0.0.1:11434
```

The app's **Ollama (local)** provider already points at that address, so with the mock
running you can exercise everything without an account. Each mock model triggers a
different path on purpose:

| Model | What it exercises |
| --- | --- |
| `mock/fast` | Normal streaming |
| `mock/markdown` | Tables, task lists, code blocks, lazy highlighting |
| `mock/slow` | The Stop button, partial replies |
| `mock/unauthorized` | 401 → "Key rejected" |
| `mock/ratelimit` | 429 → "Rate limited" + Retry |
| `mock/context` | Context overflow message |
| `mock/server-error` | 5xx → "Provider trouble" |
| `mock/empty` | Empty completion handling |

Manual checklist that was run against this build: streaming, stop, regenerate, edit &
resend, delete, model switching, invalid key (real Gemini 400 mapped to "Key rejected"),
unreachable endpoint, offline toasts, 200-message chat virtualization, mobile viewport,
light and dark, and no console errors in the production build.

---

## Deploying

```bash
npm run build      # typecheck + production bundle in dist/
```

Static host: publish `dist/`. Add the proxy function if you want the free tier
(Vercel does this automatically via `api/chat.ts`). Remember to add any extra provider
origin to the CSP in both `vite.config.ts` and `public/_headers`.

## Not in v1

No tools, agents, file uploads, or image input, by design. The provider interface and
the `StreamEvent` channel are the seams to add them: a tool-call event and a message
part type, without touching the chat shell.

## Licence

MIT.
