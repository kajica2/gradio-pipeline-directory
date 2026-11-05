// Shared static server + identity guard for the local e2e suites.
//
// Why this exists
// ---------------
// The local suites used to assume "a server is already listening on
// http://localhost:5173". That assumption is not safe on a machine with
// more than one project running: `digital_twin` already squats on 5173
// here, so `npm run e2e` was loading an unrelated page and reporting
// failures that had nothing to do with the directory — a green/red signal
// that meant nothing.
//
// Now every local suite boots its own static server on a free ephemeral
// port, rooted at this repo, and asserts that the port really is serving
// THIS project before it evaluates a single assertion. A wrong site is a
// hard error, never a silent mismatch.
//
// The suites that talk to the live site (live-verify.mjs) or to an HF Space
// (deploy-flow.mjs) do not need this module.

import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Title fragments that only this project serves.
const IDENTITY = {
  '/': 'Gradio Pipeline Directory',
  '/tester.html': 'Gradio Pipeline Tester',
};

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Boot `python3 -m http.server` on a free port, rooted at this repo.
 * Resolves once the server actually answers a request.
 */
export async function startServer({ root = PROJECT_ROOT, port } = {}) {
  const chosen = port || (await freePort());
  const child = spawn(
    'python3',
    ['-m', 'http.server', String(chosen), '--bind', '127.0.0.1', '--directory', root],
    { stdio: 'ignore' },
  );

  const base = `http://127.0.0.1:${chosen}`;
  const deadline = Date.now() + 15000;

  // Do NOT keep the parent's event loop alive on this child's behalf.
  // Without unref(), the spawned server holds the process open: the suite
  // finishes its checks, the 'exit' handler that would kill the server never
  // runs (because the loop never drains), and the suite hangs forever.
  child.unref();

  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`static server exited early (code ${child.exitCode})`);
    }
    try {
      const res = await fetch(base + '/', { signal: AbortSignal.timeout(1500) });
      if (res.ok) break;
    } catch {
      /* not listening yet */
    }
    if (Date.now() > deadline) {
      child.kill('SIGTERM');
      throw new Error(`static server did not come up on ${base} within 15s`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    base,
    port: chosen,
    stop() {
      child.kill('SIGTERM');
    },
  };
}

/**
 * Fail loudly when `base` is not serving this project.
 * Returns the title it found.
 */
export async function assertThisSite(base, path = '/') {
  const url = base.replace(/\/$/, '') + path;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`identity check failed: ${url} returned HTTP ${res.status}`);
  }

  const html = await res.text();
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [, ''])[1].trim();
  const expected = IDENTITY[path] || IDENTITY['/'];

  if (!title.includes(expected)) {
    throw new Error(
      `identity check failed: ${url} is not the Gradio Pipeline Directory ` +
        `(title was "${title || '(none)'}"). Something else is serving this ` +
        `port — refusing to run assertions against it.`,
    );
  }
  return title;
}
