#!/usr/bin/env node
// Functional e2e for tester.html.
//
// The tester page is the "does my Space actually work?" tool: it connects to
// a real deployed Gradio Space over @gradio/client, lists the API endpoints
// and fires a request. This test proves that path really works end to end
// against a public Space -- a static DOM check would not.
//
// Usage:
//   node e2e/tester.mjs                       # against the live GitHub Pages site
//   URL_BASE=http://localhost:5173 node e2e/tester.mjs
import { launch } from './browser.mjs';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.URL_BASE || 'https://kajica2.github.io/gradio-pipeline-directory';
const ART = '/Users/kaidejuricmasscmbook/.minimax/workspace/gradio-pipeline-directory/e2e/artifacts';
await mkdir(ART, { recursive: true });

// A small, public, always-on Gradio Space.
const TARGET = process.env.SPACE_ID || 'akhaliq/demucs';

const log = (...a) => console.log('[tester]', ...a);
let failed = 0;
const fail = (m) => { console.error('  ❌', m); failed++; };
const pass = (m) => console.log('  ✅', m);

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
page.setDefaultNavigationTimeout(60000);
page.setDefaultTimeout(30000);
// Never serve a stale tester.html: the page is ES-module based and the
// browser will happily reuse a cached copy of both the page and the
// @gradio/client module, which hides real fixes.
await page.setCacheEnabled(false);

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message)));

log(`Testing tester.html at ${BASE} against Space ${TARGET}`);

// 1) Page loads
const resp = await page.goto(BASE + '/tester.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
if (resp.status() !== 200) fail(`tester.html returned ${resp.status()}`);
else pass('tester.html returns 200');

// 2) Quick picks render from the directory
await page.waitForSelector('#quick-picks .chip', { timeout: 15000 });
const picks = await page.$$eval('#quick-picks .chip', (els) => els.map((e) => e.textContent.trim()));
if (!picks.length) fail('No quick-pick chips rendered');
else pass(`${picks.length} quick-pick chips: ${picks.slice(0, 4).join(', ')}`);

// 3) Connect to a real Space
await page.evaluate((id, token) => {
  document.getElementById('space-url').value = id;
  const t = document.getElementById('hf-token');
  if (token) t.value = token;
}, TARGET, process.env.HF_TOKEN || '');
await page.click('#connect-btn');

// 4) The endpoint list must populate -- this is the whole point of the page
let endpointCount = 0;
try {
  await page.waitForFunction(
    () => document.querySelectorAll('#endpoints .endpoint').length > 0,
    { timeout: 45000 },
  );
  endpointCount = await page.$$eval('#endpoints .endpoint', (els) => els.length);
} catch {
  /* fall through to the log dump below */
}
if (endpointCount > 0) pass(`Connected to ${TARGET} — ${endpointCount} endpoint(s) listed`);
else {
  fail(`No endpoints listed for ${TARGET}`);
  const logText = await page.$eval('#log', (el) => el.textContent.trim()).catch(() => '(no log)');
  console.error('     tester log:\n' + logText.split('\n').map((l) => '       ' + l).join('\n'));
}

// 5) Selecting an endpoint builds a form
if (endpointCount > 0) {
  // Pick the endpoint with the most inputs -- that is the one with a real
  // form to render.
  const picked = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('#endpoints .endpoint'));
    let best = 0;
    let bestCount = -1;
    nodes.forEach((n, i) => {
      const m = n.textContent.match(/(\d+)\s+input/);
      const c = m ? parseInt(m[1], 10) : 0;
      if (c > bestCount) { bestCount = c; best = i; }
    });
    if (nodes[best]) nodes[best].click();
    return { index: best, inputs: bestCount };
  });
  await new Promise((r) => setTimeout(r, 400));

  const selected = await page.$eval('#selected-endpoint', (el) => el.textContent.trim());
  const formReady = await page.evaluate(() => {
    const form = document.getElementById('endpoint-form');
    // A real form control, not just a bit of prose.
    return !!form.querySelector('input, textarea, select, button');
  });
  if (!/^—/.test(selected) && formReady) {
    pass(`Endpoint selected: ${selected} — form generated (${picked.inputs} input field(s))`);
  } else {
    fail(`Endpoint selection did not build a form (selected="${selected}", formReady=${formReady})`);
  }
}

// 6) Fire a real request and get a response back
if (endpointCount > 0) {
  const respText = await page.$eval('#response', (el) => el.textContent.trim());
  if (/Form ready/.test(respText)) {
    // Keep the payload tiny: a long default prompt can sit in a ZeroGPU
    // queue for minutes.
    await page.evaluate(() => {
      const inputs = document.querySelectorAll('#endpoint-form input[type="text"], #endpoint-form textarea');
      if (inputs[0]) {
        inputs[0].value = 'Hi.';
        inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      }
    });
    await page.click('#call-btn');
    let settled = false;
    let waitErr = '';
    try {
      // The response box holds the payload; the log line is what says
      // "response received" / "Error:".
      await page.waitForFunction(
        () => {
          const el = document.getElementById('log');
          if (!el) return false;
          return /response received|Error:/i.test(el.textContent);
        },
        { timeout: 120000, polling: 500 },
      );
      settled = true;
    } catch (e) {
      settled = false;
      waitErr = String(e && e.message ? e.message : e);
    }
    const out = await page.$eval('#response', (el) => el.textContent.trim());
    if (settled && /ZeroGPU quota/i.test(out)) {
      // The anonymous ZeroGPU allowance is spent for the day -- an
      // environment condition, not a defect in the page.
      console.log('  ⚠️  Space returned a ZeroGPU quota error (needs an HF token) — skipping');
    } else if (settled && !/^Error:/.test(out)) {
      pass(`Request fired and returned a response (${out.length} chars)`);
    } else if (settled) {
      fail(`Request returned an error: ${out.slice(0, 200)}`);
    } else {
      const logTail = await page.$eval('#log', (el) => el.textContent.trim().slice(-200));
      fail(`Request did not settle (${waitErr}). log tail: ${logTail}`);
    }
  } else {
    console.log('  ⚠️  Form was not ready, skipping the fire-request check');
  }
}

// 7) The log recorded a successful connection
const logText = await page.$eval('#log', (el) => el.textContent);
if (/Connected\. Found \d+ endpoint/i.test(logText)) pass('Tester log reports a successful connection');
else fail('Tester log does not report a successful connection');

await page.screenshot({ path: ART + '/tester-live.png', fullPage: true });

if (pageErrors.length) {
  fail(`Page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
} else {
  pass('No uncaught page errors');
}

console.log();
if (failed) {
  console.error(`❌ ${failed} CHECK(S) FAILED`);
  process.exitCode = 1;
} else {
  console.log('✅ ALL TESTER CHECKS PASSED');
}
await browser.close();
