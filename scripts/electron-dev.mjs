#!/usr/bin/env node
/**
 * `npm run electron:dev` — Vite dev server plus an Electron window pointed at it.
 *
 * Two processes, one command, no `concurrently`/`wait-on` dependency: the Vite
 * server is started first, we poll it until it actually answers, and only then
 * does Electron load the URL. Loading too early gives a white window and a
 * retry loop, which is the usual way this setup goes wrong.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.CHATBOT_DEV_PORT || 5173);
const URL = `http://localhost:${PORT}`;
const READY_TIMEOUT_MS = 45_000;

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        /* already gone */
      }
    }
  }
  process.exit(code);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

function start(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', ...options });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 0);
  });
  return child;
}

async function waitForServer() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(URL, { method: 'GET' });
      if (response.ok || response.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  return false;
}

async function main() {
  let electronPath;
  try {
    electronPath = require('electron');
  } catch {
    console.error('\nElectron is not installed. Run:  npm install\n');
    process.exit(1);
  }

  console.log(`Starting Vite on ${URL} …`);
  start(process.execPath, [require.resolve('vite/bin/vite.js'), '--port', String(PORT), '--strictPort']);

  if (!(await waitForServer())) {
    console.error(`\nVite did not answer on ${URL} within ${READY_TIMEOUT_MS / 1000}s.\n`);
    shutdown(1);
    return;
  }

  console.log('Launching Electron …');
  start(electronPath, [root], {
    env: { ...process.env, CHATBOT_DEV_SERVER_URL: URL, ELECTRON_ENABLE_LOGGING: '1' },
  });
}

void main();
