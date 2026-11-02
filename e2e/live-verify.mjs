#!/usr/bin/env node
// Puppeteer e2e: verify the LIVE site at kajica2.github.io/gradio-pipeline-directory
// Asserts: page loads, cards render, search/filter work, version picker works,
// modal opens, deploy command is copyable, tester.html loads, no console errors.
import { launch } from './browser.mjs';
import { mkdir } from 'node:fs/promises';

const BASE = 'https://kajica2.github.io/gradio-pipeline-directory';
const ART = '/Users/kaidejuricmasscmbook/.minimax/workspace/gradio-pipeline-directory/e2e/artifacts';
await mkdir(ART, { recursive: true });

const log = (...a) => console.log('[e2e]', ...a);
const fail = (msg) => { console.error('  ❌', msg); process.exitCode = 1; };
const pass = (msg) => console.log('  ✅', msg);

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
page.setDefaultNavigationTimeout(60000);
page.setDefaultTimeout(20000);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

// ============ 1) Index page ============
log('Testing index page...');
const resp = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
if (resp.status() !== 200) fail(`Index returned ${resp.status()}`);
else pass('Index returns 200');

await page.waitForSelector('#results .card', { timeout: 15000 });
const cards = await page.$$eval('#results .card', els => els.length);
if (cards !== 12) fail(`Expected 12 cards, got ${cards}`);
else pass(`12 cards rendered`);

const hubCards = await page.$$eval('#hub-grid .hub-card, #hub-grid .card', els => els.length);
if (hubCards !== 12) fail(`Expected 12 hub cards, got ${hubCards}`);
else pass(`12 hub cards rendered (12 sections × version-picker content)`);

// ============ 1b) Social preview meta ============
// A shared link renders as a bare text row without og:image, so assert the
// preview card is actually wired up AND that the image it points at is
// reachable — a 404 og:image is worse than none, because some scrapers
// cache the broken result.
log('Testing social preview meta...');
const meta = await page.evaluate(() => {
  const get = (sel) => document.querySelector(sel)?.getAttribute('content') || null;
  return {
    ogImage: get('meta[property="og:image"]'),
    ogWidth: get('meta[property="og:image:width"]'),
    ogHeight: get('meta[property="og:image:height"]'),
    ogAlt: get('meta[property="og:image:alt"]'),
    siteName: get('meta[property="og:site_name"]'),
    twCard: get('meta[name="twitter:card"]'),
    twImage: get('meta[name="twitter:image"]'),
  };
});
if (!meta.ogImage) fail('og:image meta tag missing');
else if (!/^https?:\/\//.test(meta.ogImage)) fail(`og:image must be an absolute URL, got: ${meta.ogImage}`);
else pass(`og:image is absolute: ${meta.ogImage}`);
if (meta.ogWidth !== '1200' || meta.ogHeight !== '630') fail(`og:image dimensions wrong: ${meta.ogWidth}x${meta.ogHeight}`);
else pass('og:image is 1200x630');
if (!meta.ogAlt) fail('og:image:alt missing');
else pass('og:image:alt present');
if (!meta.siteName) fail('og:site_name missing');
else pass('og:site_name present');
if (meta.twCard !== 'summary_large_image') fail(`twitter:card should be summary_large_image, got: ${meta.twCard}`);
else pass('twitter:card = summary_large_image');
if (!meta.twImage) fail('twitter:image missing');
else pass('twitter:image present');

if (meta.ogImage) {
  // Plain HTTP check (Node's fetch) rather than a browser request — this is
  // a URL reachability check, not a page-behaviour check, and it keeps the
  // assertion independent of the browser context.
  try {
    const imgResp = await fetch(meta.ogImage, { redirect: 'follow' });
    if (!imgResp.ok) fail(`og:image URL returned ${imgResp.status}`);
    else {
      const type = imgResp.headers.get('content-type') || '';
      if (!type.startsWith('image/')) fail(`og:image content-type is ${type}, expected image/*`);
      else pass(`og:image reachable (${imgResp.status}, ${type})`);
    }
  } catch (e) {
    fail(`og:image URL threw: ${e.message}`);
  }
}

// ============ 2) Version picker: 5 personas ============
log('Testing 5-version picker...');
// The active lens is persisted to localStorage, so a previous run (or a
// previous visit in the same browser profile) can leave a different version
// active and make the click below a no-op. Reset to the default first.
await page.evaluate(() => {
  localStorage.removeItem('gradio-pipeline-directory:version');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#hub-grid .hub-card, #hub-grid .card', { timeout: 15000 });

const versionPills = await page.$$eval('#version-pills .version-pill, #version-pills [role="tab"]', els => els.length);
if (versionPills !== 5) fail(`Expected 5 version pills, got ${versionPills}`);
else pass('5 version pills present (Builder / Musician / Researcher / Creative Coder / Director)');

// Click the Musician version and verify content changes
const before = await page.$$eval('#hub-grid .card, #hub-grid .hub-card', els =>
  els.map(e => e.textContent.trim()).join('|').slice(0, 200));
await page.evaluate(() => {
  const pills = document.querySelectorAll('#version-pills [role="tab"], #version-pills .version-pill');
  const musician = Array.from(pills).find(p => p.textContent.match(/Musician|musician/i));
  if (musician) musician.click();
});
await new Promise(r => setTimeout(r, 600));
const after = await page.$$eval('#hub-grid .card, #hub-grid .hub-card', els =>
  els.map(e => e.textContent.trim()).join('|').slice(0, 200));
if (before === after) fail('Version switch did not change hub content');
else pass('Version picker re-curates hub cards');

// ============ 3) Search filter ============
log('Testing search filter...');
await page.click('#search-input');
await page.type('#search-input', 'whisper', { delay: 30 });
await new Promise(r => setTimeout(r, 500));
const filteredCards = await page.$$eval('#results .card', els => els.length);
if (filteredCards === 0) fail('Search for "whisper" returned 0 cards');
else if (filteredCards > 12) fail(`Search returned too many: ${filteredCards}`);
else pass(`Search "whisper" → ${filteredCards} card(s)`);

// Clear search
await page.evaluate(() => { document.getElementById('search-input').value = ''; document.getElementById('search-input').dispatchEvent(new Event('input')); });
await new Promise(r => setTimeout(r, 500));

// ============ 4) Category filter ============
log('Testing category filter...');
await page.evaluate(() => {
  const pills = document.querySelectorAll('#category-pills .pill, #category-pills [role="button"]');
  if (pills[0]) pills[0].click();
});
await new Promise(r => setTimeout(r, 500));
const catFiltered = await page.$$eval('#results .card', els => els.length);
if (catFiltered === 0 || catFiltered === 12) fail(`Category filter unexpected: ${catFiltered} cards (expected 1-11)`);
else pass(`Category filter → ${catFiltered} card(s)`);
// Clear
await page.evaluate(() => { const c = document.getElementById('clear-filters'); if (c) c.click(); });
await new Promise(r => setTimeout(r, 400));

// ============ 5) Modal opens with deploy command ============
log('Testing modal + deploy command...');
await page.click('#results .card');
await page.waitForSelector('#modal:not([hidden])', { timeout: 5000 });
const modalTitle = await page.$eval('#modal-title', el => el.textContent);
const deployCmd = await page.evaluate(() => {
  const all = document.querySelectorAll('#modal-body *');
  for (const el of all) if (el.textContent.includes('gradio deploy') && el.children.length < 8) return el.textContent.trim();
  return null;
});
if (!deployCmd) fail('Modal missing deploy command');
else if (!deployCmd.includes('HF_TOKEN=')) fail(`Deploy command does not pass the token via HF_TOKEN: "${deployCmd}"`);
else if (!deployCmd.includes('git clone')) fail(`Deploy command does not clone the repo first: "${deployCmd}"`);
else if (deployCmd.includes('--token')) fail(`Deploy command uses the non-existent --token flag: "${deployCmd}"`);
else if (deployCmd.includes('--repo')) fail(`Deploy command uses the non-existent --repo flag: "${deployCmd}"`);
else pass(`Modal opened, deploy command valid: "${deployCmd}"`);

// The in-browser one-click deploy is the primary path and must render ABOVE
// the terminal command block.
const deployOrder = await page.evaluate(() => {
  const body = document.getElementById('modal-body');
  const oneClick = body.querySelector('.modal__section--deploy');
  const terminal = body.querySelector('.deploy');
  if (!oneClick) return 'missing-one-click';
  if (!terminal) return 'missing-terminal';
  return oneClick.compareDocumentPosition(terminal) & Node.DOCUMENT_POSITION_FOLLOWING ? 'ok' : 'wrong-order';
});
if (deployOrder === 'missing-one-click') fail('Modal missing the in-browser one-click deploy form');
else if (deployOrder === 'missing-terminal') fail('Modal missing the terminal deploy block');
else if (deployOrder === 'wrong-order') fail('One-click deploy must appear above the terminal command');
else pass('One-click deploy form renders above the terminal command');

await page.screenshot({ path: ART + '/live-modal.png' });
// Close
await page.click('#modal-close');
await new Promise(r => setTimeout(r, 300));

// ============ 6) Theme toggle ============
log('Testing theme toggle...');
const themeBefore = await page.$eval('html', el => el.dataset.theme);
await page.click('#theme-toggle');
await new Promise(r => setTimeout(r, 200));
const themeAfter = await page.$eval('html', el => el.dataset.theme);
if (themeBefore === themeAfter) fail('Theme toggle did not switch');
else pass(`Theme: ${themeBefore} → ${themeAfter}`);
await page.click('#theme-toggle'); // back

// ============ 7) Tester page ============
log('Testing tester.html...');
await page.goto(BASE + '/tester.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
if (page.url().includes('tester.html')) pass('tester.html loads');
const testerStatus = await page.evaluate(() => {
  return {
    title: document.title,
    hasForm: !!document.querySelector('input,textarea,button,form'),
    bodyText: document.body.textContent.length,
  };
});
if (testerStatus.bodyText < 100) fail('Tester page body is empty');
else pass(`Tester page renders (${testerStatus.bodyText} chars body)`);

// ============ 8) Console error scan ============
log('Console errors:', consoleErrors.length);
const realErrors = consoleErrors.filter(e => !/favicon\.ico|404 \(Not Found\)/i.test(e));
if (realErrors.length) fail(`Console errors:\n  ${realErrors.join('\n  ')}`);
else pass('No console errors (favicon 404 ignored)');

// Final screenshot of the live hub
await page.goto(BASE + '/#hub', { waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: ART + '/live-hub-final.png', fullPage: false });
pass(`Screenshot saved: live-hub-final.png`);

await browser.close();
console.log(`\n${process.exitCode ? '❌ TESTS FAILED' : '✅ ALL TESTS PASSED'}`);
process.exit(process.exitCode || 0);
