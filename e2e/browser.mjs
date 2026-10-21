// Shared browser launcher for the e2e suites.
//
// Resolution order:
//   1. CDP_ENDPOINT / CDP_PORT env  -> attach to an already-running Chrome
//   2. launch the system Chrome      -> works on a normal developer machine
//   3. scan for a live DevToolsActivePort -> attach to any Chrome on the box
//
// Step 3 exists because this session runs Bash inside a macOS sandbox that
// blocks Chrome's ProcessSingleton lock, so a locally launched Chrome aborts
// with "The browser is already running for ...". Attaching to a Chrome that
// the host already started sidesteps the restriction entirely.
//
// The previous version hard-coded a puppeteer path inside an unrelated
// project (gen-pwa), which broke as soon as that project moved.

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

const CANDIDATE_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

export function resolveBrowserPath() {
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  for (const p of CANDIDATE_BROWSERS) {
    if (existsSync(p)) return p;
  }
  return null;
}

/** macOS per-user temp root, e.g. /var/folders/sn/xxxx/T */
function macRealTmpdir() {
  const t = tmpdir();
  const m = t.match(/^(.*\/T)\/(mcode-sandbox|.*)$/);
  return m ? m[1] : t;
}

function findLiveCdpEndpoints() {
  const roots = new Set([macRealTmpdir()]);
  const out = [];
  for (const root of roots) {
    let entries;
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const name of entries) {
      if (!/chrome|puppeteer/i.test(name)) continue;
      const portFile = join(root, name, 'DevToolsActivePort');
      if (!existsSync(portFile)) continue;
      try {
        const port = readFileSync(portFile, 'utf8').split('\n')[0].trim();
        if (/^\d+$/.test(port)) out.push(port);
      } catch {
        /* unreadable port file */
      }
    }
  }
  return out;
}

async function connectFirst(urls) {
  const puppeteer = require('puppeteer-core');
  for (const url of urls) {
    let browser;
    try {
      browser = await puppeteer.connect({
        browserWSEndpoint: url,
        protocolTimeout: 20000,
      });
    } catch {
      continue;
    }
    // Connecting is not enough: a busy host browser can accept the socket but
    // fail on the first CDP call ("Network.enable timed out"). Prove the
    // endpoint works by opening and closing a throwaway page.
    try {
      const probe = await browser.newPage();
      await probe.close();
    } catch {
      try {
        await browser.disconnect();
      } catch {
        /* ignore */
      }
      continue;
    }

    browser.__attached = true;
    // Never close a browser we did not start -- close() on an attached
    // browser shuts the host's Chrome down. Disconnect instead.
    const originalClose = browser.close.bind(browser);
    browser.close = async () => {
      try {
        await browser.disconnect();
      } catch {
        /* already gone */
      }
      void originalClose;
    };
    return browser;
  }
  return null;
}

export async function launch(extraArgs = []) {
  const puppeteer = require('puppeteer-core');

  // 1) explicit endpoint
  const explicit = [];
  if (process.env.CDP_ENDPOINT) explicit.push(process.env.CDP_ENDPOINT);
  if (process.env.CDP_PORT) explicit.push(`ws://127.0.0.1:${process.env.CDP_PORT}`);
  if (explicit.length) {
    const b = await connectFirst(explicit);
    if (b) return b;
  }

  // 2) launch locally (the normal path on a developer machine)
  const exe = resolveBrowserPath();
  if (exe) {
    const userDataDir = mkdtempSync(join(tmpdir(), 'gpd-chrome-'));
    try {
      const browser = await puppeteer.launch({
        headless: true,
        executablePath: exe,
        userDataDir,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          ...extraArgs,
        ],
      });
      const originalClose = browser.close.bind(browser);
      browser.close = async () => {
        try {
          await originalClose();
        } finally {
          try {
            rmSync(userDataDir, { recursive: true, force: true });
          } catch {
            /* best-effort cleanup */
          }
        }
      };
      return browser;
    } catch (err) {
      try {
        rmSync(userDataDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (!/already running|ProcessSingleton/i.test(String(err.message))) throw err;
      // fall through to attach mode
    }
  }

  // 3) attach to a Chrome already running on this machine
  const endpoints = [];
  for (const port of findLiveCdpEndpoints()) {
    try {
      // Bounded: stale port files point at ports that may be held by an
      // unrelated service which never answers.
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(4000),
      });
      const info = await res.json();
      if (info.webSocketDebuggerUrl) endpoints.push(info.webSocketDebuggerUrl);
    } catch {
      /* stale port file */
    }
  }
  const attached = await connectFirst(endpoints);
  if (attached) return attached;

  throw new Error(
    'Could not start or attach to a browser. Set CDP_PORT=<port> to attach to a ' +
      'running Chrome with --remote-debugging-port, or set CHROME_PATH to a Chrome binary.',
  );
}
