/**
 * Minimal, stateless free-tier proxy.
 *
 * Purpose: let the app work with zero setup for people who don't want to paste a
 * key, by lending them a *rate-limited* slice of a free-tier model.
 *
 * Rules this file lives by:
 *  - No request or response bodies are ever logged. No prompts, no keys.
 *  - The upstream model is chosen server-side. A client cannot ask for a
 *    different (expensive) model, so an exposed deployment cannot be drained.
 *  - No storage. Everything lives in memory for the lifetime of the process.
 *
 * It speaks the OpenAI chat-completions SSE protocol, so the browser only needs
 * the ordinary OpenAI-compatible adapter to talk to it.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const GEMINI_OPENAI_URL =
  'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const MAX_MESSAGES = 60;
const MAX_CHARS_PER_MESSAGE = 24000;
const MAX_TOTAL_CHARS = 120000;

/** @type {Map<string, {minute: number[], day: number[]}>} */
const buckets = new Map();

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function resolveConfig(env) {
  const provider = String(env.FREE_PROXY_PROVIDER || 'openrouter').toLowerCase();
  if (provider === 'gemini') {
    const allowed = String(env.FREE_PROXY_ALLOWED_MODELS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      provider: 'gemini',
      upstream: GEMINI_OPENAI_URL,
      apiKey: env.GEMINI_API_KEY || env.GOOGLE_API_KEY || '',
      model: env.FREE_PROXY_MODEL || 'gemini-3.5-flash-lite',
      allowed,
      label: 'Gemini free tier, hosted by this deployment',
    };
  }
  const allowed = String(env.FREE_PROXY_ALLOWED_MODELS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    provider: 'openrouter',
    upstream: OPENROUTER_URL,
    apiKey: env.OPENROUTER_API_KEY || '',
    model: env.FREE_PROXY_MODEL || 'google/gemma-4-31b-it:free',
    allowed,
    label: 'OpenRouter free model, hosted by this deployment',
  };
}

/** In-memory per-IP rate limiting. Good enough for a free tier. */
function rateLimit(key, env) {
  const rpm = Number(env.FREE_PROXY_RPM || 12);
  const rpd = Number(env.FREE_PROXY_RPD || 200);
  const now = Date.now();
  let b = buckets.get(key);
  if (!b) {
    b = { minute: [], day: [] };
    buckets.set(key, b);
  }
  b.minute = b.minute.filter((t) => now - t < 60_000);
  b.day = b.day.filter((t) => now - t < 86_400_000);
  if (b.minute.length >= rpm) return { ok: false, scope: 'minute', limit: rpm };
  if (b.day.length >= rpd) return { ok: false, scope: 'day', limit: rpd };
  b.minute.push(now);
  b.day.push(now);
  if (buckets.size > 5000) {
    for (const [k, v] of buckets) {
      if (!v.day.length || now - v.day[v.day.length - 1] > 86_400_000) buckets.delete(k);
    }
  }
  return { ok: true };
}

/** Trim payloads so a shared key can't be used as a free CDN or a DOS tool. */
function normalizeBody(body, cfg) {
  const raw = Array.isArray(body?.messages) ? body.messages : null;
  if (!raw || raw.length === 0) return { error: 'messages_required' };
  if (raw.length > MAX_MESSAGES) return { error: 'too_many_messages' };

  let total = 0;
  const messages = [];
  for (const m of raw) {
    const role = m?.role === 'assistant' || m?.role === 'system' ? m.role : 'user';
    const content = typeof m?.content === 'string' ? m.content : '';
    if (!content) continue;
    if (content.length > MAX_CHARS_PER_MESSAGE) return { error: 'message_too_long' };
    total += content.length;
    if (total > MAX_TOTAL_CHARS) return { error: 'conversation_too_long' };
    messages.push({ role, content });
  }
  if (!messages.length) return { error: 'messages_required' };

  const requested = typeof body?.model === 'string' ? body.model : '';
  const model =
    requested && cfg.allowed.includes(requested) ? requested : cfg.model;

  return {
    model,
    messages,
    stream: true,
    temperature:
      typeof body?.temperature === 'number'
        ? Math.min(Math.max(body.temperature, 0), 1.5)
        : 0.7,
    max_tokens: Math.min(Number(body?.max_tokens) || 2048, 4096),
    stream_options: { include_usage: true },
  };
}

/**
 * @param {Request} request
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<Response>}
 */
export async function handleProxy(request, env = {}) {
  const url = new URL(request.url);
  const cfg = resolveConfig(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type' },
    });
  }

  if (url.pathname.endsWith('/health')) {
    return json({
      ok: true,
      service: 'free-proxy',
      configured: Boolean(cfg.apiKey),
      provider: cfg.provider,
      model: cfg.model,
      allowedModels: cfg.allowed,
      label: cfg.label,
    });
  }

  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  if (!cfg.apiKey) {
    return json(
      {
        error: 'proxy_not_configured',
        message:
          'This deployment does not host a free tier. Add OPENROUTER_API_KEY or GEMINI_API_KEY to the server environment, or use your own API key in Settings.',
      },
      501,
    );
  }

  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'local';
  const limit = rateLimit(ip, env);
  if (!limit.ok) {
    return json(
      {
        error: 'rate_limited',
        scope: limit.scope,
        message:
          limit.scope === 'minute'
            ? `The shared free tier allows ${limit.limit} messages per minute. Add your own API key in Settings for unlimited use.`
            : `The shared free tier allows ${limit.limit} messages per day. Add your own API key in Settings for unlimited use.`,
      },
      429,
      { 'retry-after': limit.scope === 'minute' ? '60' : '3600' },
    );
  }

  let parsed;
  try {
    parsed = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const payload = normalizeBody(parsed, cfg);
  if (payload.error) {
    return json(
      {
        error: payload.error,
        message:
          payload.error === 'conversation_too_long' || payload.error === 'too_many_messages'
            ? 'This conversation is too long for the shared free tier. Start a new chat or use your own API key.'
            : 'That request could not be forwarded.',
      },
      400,
    );
  }

  /** @type {Record<string, string>} */
  const headers = {
    'content-type': 'application/json',
    accept: 'text/event-stream',
    authorization: `Bearer ${cfg.apiKey}`,
  };
  if (cfg.provider === 'openrouter') {
    headers['http-referer'] = url.origin;
    headers['x-title'] = 'Chatbot (free tier)';
  }

  let upstream;
  try {
    upstream = await fetch(cfg.upstream, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: request.signal,
    });
  } catch {
    return json(
      { error: 'upstream_unreachable', message: 'The shared free tier could not be reached.' },
      502,
    );
  }

  if (!upstream.ok || !upstream.body) {
    // Never echo the upstream body: it can contain key-shaped fragments.
    const status = upstream.status;
    const message =
      status === 401 || status === 403
        ? 'The shared free tier is misconfigured. Use your own API key in Settings.'
        : status === 402
          ? 'The shared free tier is out of credit right now. Use your own API key in Settings.'
          : status === 429
            ? 'The upstream provider is rate limiting the shared free tier. Try again shortly, or use your own API key.'
            : 'The shared free tier is unavailable right now.';
    return json({ error: 'upstream_error', status, message }, status === 429 ? 429 : 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}

/**
 * Vite dev-server middleware so `npm run dev` gets the free tier for free.
 * @param {Record<string, string | undefined>} env
 */
export function createNodeMiddleware(env) {
  return async function freeProxyMiddleware(req, res, next) {
    const url = req.url || '';
    if (!url.startsWith('/api/')) return next();
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(', '));
      }
      const request = new Request(new URL(url, `http://${req.headers.host || 'localhost'}`), {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
      });
      const response = await handleProxy(request, env);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (!response.body) {
        res.end();
        return;
      }
      const { Readable } = await import('node:stream');
      Readable.fromWeb(response.body).pipe(res);
    } catch (err) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ error: 'proxy_failure' }));
    }
  };
}
