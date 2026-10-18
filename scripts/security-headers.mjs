/**
 * Single source of truth for the Content-Security-Policy.
 *
 * Three consumers must never drift:
 *  - vite.config.ts injects a <meta> CSP into the document (no frame-ancestors:
 *    a meta tag cannot carry it and browsers log an error if it tries).
 *  - public/_headers (Netlify / Cloudflare Pages) and vercel.json carry the
 *    real response header, which adds frame-ancestors 'none'.
 *  - tests/security-headers.test.ts regenerates both files' expected content
 *    and fails the build when anyone edits a header file by hand.
 *
 * Invariant enforced by that test: index.html contains NO inline scripts, so
 * every source can use the same script-src without hashes. If you need an
 * inline script, put it in public/ and reference it — don't break the invariant.
 */

/** Every origin the browser is allowed to reach. Adding a provider means adding
 * its API origin here (see README). */
export const PROVIDER_ORIGINS = [
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

/**
 * @param {{ frameAncestors?: boolean, scriptHashes?: string[] }} [opts]
 * @returns {string}
 */
export function buildCsp(opts = {}) {
  const { frameAncestors = false, scriptHashes = [] } = opts;
  const scriptSrc = ["'self'", "'wasm-unsafe-eval'", ...scriptHashes].join(' ').trim();
  const directives = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${PROVIDER_ORIGINS.join(' ')}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
  ];
  if (frameAncestors) directives.push("frame-ancestors 'none'");
  directives.push("form-action 'none'");
  return directives.join('; ');
}

/** The full security-header block shared by Netlify and Vercel. */
export function buildSecurityHeaders() {
  return {
    'Content-Security-Policy': buildCsp({ frameAncestors: true }),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), payment=()',
  };
}

/** Exact expected content of public/_headers. */
export function expectedHeadersFile() {
  const h = buildSecurityHeaders();
  return `# Security headers for Netlify, Cloudflare Pages and friends.
# GENERATED from scripts/security-headers.mjs — do not edit by hand.
# Run: node scripts/generate-headers.mjs   (a unit test fails if this drifts)
# A meta tag cannot carry frame-ancestors, so the strict policy lives here and
# in vercel.json; vite.config.ts injects the same policy without that directive.

/*
${Object.entries(h)
  .map(([k, v]) => `  ${k}: ${v}`)
  .join('\n')}
`;
}

/** Exact expected content of vercel.json (as a structured object). */
export function expectedVercelConfig() {
  const h = buildSecurityHeaders();
  return {
    $schema: 'https://openapi.vercel.sh/vercel.json',
    headers: [
      {
        source: '/(.*)',
        headers: Object.entries(h).map(([key, value]) => ({ key, value })),
      },
    ],
  };
}
