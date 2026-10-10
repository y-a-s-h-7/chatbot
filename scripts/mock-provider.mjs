#!/usr/bin/env node
/**
 * A tiny local OpenAI-compatible server for development and testing.
 *
 *   npm run mock            # listens on http://127.0.0.1:11434/v1
 *   npm run mock -- 12345   # or a port of your choice
 *
 * Point the app's "Ollama (local)" provider at it (that is already the default
 * base URL) and you can exercise streaming, Stop, retries and every error path
 * without touching a real provider or spending a cent. Each model name below
 * deliberately triggers a different behaviour.
 *
 * The responses are canned; this is a mock, not a model.
 */

import { createServer } from 'node:http';

const PORT = Number(process.argv[2] || process.env.MOCK_PORT || 11434);

const MODELS = [
  { id: 'mock/fast', name: 'Mock Fast' },
  { id: 'mock/markdown', name: 'Mock Markdown' },
  { id: 'mock/slow', name: 'Mock Slow (for Stop)' },
  { id: 'mock/unauthorized', name: 'Mock 401' },
  { id: 'mock/ratelimit', name: 'Mock 429' },
  { id: 'mock/context', name: 'Mock context overflow' },
  { id: 'mock/server-error', name: 'Mock 500' },
  { id: 'mock/empty', name: 'Mock empty reply' },
  { id: 'mock/stall', name: 'Mock stall (never finishes)' },
  { id: 'mock/needs-auth', name: 'Mock requires key (test-key-ok)' },
];

/** Only this bearer token is accepted by mock/needs-auth. */
const VALID_TOKEN = 'test-key-ok';

const SHORT = 'Here is a short answer. It streams token by token so you can watch the batching work.';

const MARKDOWN = `## Result

Here is a table and some code.

| Step | What happens |
| --- | --- |
| 1 | The request goes straight from your browser |
| 2 | Tokens arrive as SSE and are batched per frame |

\`\`\`ts
export async function stream(prompt: string) {
  for await (const chunk of provider.stream(prompt)) {
    process.stdout.write(chunk);
  }
}
\`\`\`

- [x] Streaming
- [x] Stop button
- [ ] Everything else

> Long replies stay smooth because only the streaming bubble re-renders.
`;

function tokenize(text) {
  // Split into ~3-6 character pieces so it looks like real token traffic.
  const pieces = [];
  let index = 0;
  while (index < text.length) {
    const size = 3 + Math.floor(Math.random() * 4);
    pieces.push(text.slice(index, index + size));
    index += size;
  }
  return pieces;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, accept, x-requested-with',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-max-age': '86400',
};

function json(res, status, body) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function fail(res, status, message, code) {
  json(res, status, { error: { message, type: 'mock_error', code: code ?? status } });
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/\/+$/, '');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (path.endsWith('/models') && req.method === 'GET') {
    // Like most providers, the model list is readable with any (or no) key. Only
    // an actual completion checks the credential.
    json(res, 200, {
      object: 'list',
      data: MODELS.map((model) => ({ id: model.id, object: 'model', name: model.name, context_length: 131072 })),
    });
    return;
  }

  if (!path.endsWith('/chat/completions') || req.method !== 'POST') {
    json(res, 404, { error: { message: 'Not found' } });
    return;
  }

  const body = await readBody(req);
  const model = String(body.model ?? 'mock/fast');

  // Exercises the real "paste a key, use it immediately" loop: the right bearer
  // token streams, anything else is rejected the way a provider would.
  if (model.endsWith('needs-auth')) {
    const auth = String(req.headers.authorization ?? '');
    if (auth !== `Bearer ${VALID_TOKEN}`) return fail(res, 401, 'Invalid API key provided.', 'invalid_api_key');
  }

  if (model.endsWith('unauthorized')) return fail(res, 401, 'Invalid API key provided.', 'invalid_api_key');
  if (model.endsWith('ratelimit')) return fail(res, 429, 'Rate limit exceeded for this free tier.', 'rate_limit_exceeded');
  if (model.endsWith('context')) {
    return fail(res, 400, 'This model\'s maximum context length is 8192 tokens, however you requested 12000 tokens.', 'context_length_exceeded');
  }
  if (model.endsWith('server-error')) return fail(res, 503, 'Upstream provider unavailable.', 'service_unavailable');

  // A stream that opens, sends a little text and then stalls forever. Useful for
  // testing Stop, abort-on-delete and abort-on-switch deterministically.
  if (model.endsWith('stall')) {
    res.writeHead(200, {
      ...CORS,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write(
      `data: ${JSON.stringify({ id: 'stall', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'Starting to answer' } }] })}\n\n`,
    );
    await new Promise((resolve) => {
      req.on('close', resolve);
      res.on('close', resolve);
      setTimeout(resolve, 120000);
    });
    return;
  }

  const wantsMarkdown = model.endsWith('markdown');
  const text = model.endsWith('empty') ? '' : wantsMarkdown ? MARKDOWN : SHORT;
  const delayMs = model.endsWith('slow') ? 450 : wantsMarkdown ? 12 : 6;

  res.writeHead(200, {
    ...CORS,
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });

  const id = `chatcmpl-${Date.now().toString(36)}`;
  let aborted = false;
  req.on('close', () => {
    aborted = true;
  });

  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' } }] })}\n\n`);

  for (const piece of tokenize(text)) {
    if (aborted) return;
    res.write(
      `data: ${JSON.stringify({
        id,
        object: 'chat.completion.chunk',
        choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
      })}\n\n`,
    );
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  if (aborted) return;
  res.write(`data: ${JSON.stringify({ id, object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
  res.write(
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      choices: [],
      usage: { prompt_tokens: 42, completion_tokens: 128 },
    })}\n\n`,
  );
  res.write('data: [DONE]\n\n');
  res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock provider listening on http://127.0.0.1:${PORT}/v1`);
  console.log(`models: ${MODELS.map((model) => model.id).join(', ')}`);
});
