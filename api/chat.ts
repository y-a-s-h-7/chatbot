import { handleProxy } from '../server/proxy.mjs';

export const config = { runtime: 'edge' };

/**
 * Stateless edge function. Same core as the dev-server middleware.
 * Deploy target: Vercel / Netlify Edge. No filesystem, no storage, no logs.
 */
export default async function handler(request: Request, context?: { env?: Record<string, string> }) {
  const env = context?.env ?? (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
  return handleProxy(request, env as Record<string, string | undefined>);
}
