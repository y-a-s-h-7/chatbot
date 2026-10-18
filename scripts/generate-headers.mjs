/**
 * Rewrites public/_headers and vercel.json from scripts/security-headers.mjs,
 * the single source of truth. Run after editing that file:
 *
 *   node scripts/generate-headers.mjs
 *
 * tests/security-headers.test.ts fails if these files drift from the source.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expectedHeadersFile, expectedVercelConfig } from './security-headers.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

writeFileSync(path.join(root, 'public', '_headers'), expectedHeadersFile(), 'utf8');
writeFileSync(path.join(root, 'vercel.json'), `${JSON.stringify(expectedVercelConfig(), null, 2)}\n`, 'utf8');

console.log('Regenerated public/_headers and vercel.json from scripts/security-headers.mjs');
