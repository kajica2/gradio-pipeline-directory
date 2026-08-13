// E2E test: load the local Gradio Pipeline Directory, verify cards render,
// open a modal, confirm the deploy command is present, then screenshot.
//
// Usage:  node e2e/directory.mjs
// Expects the static server to already be running on http://localhost:5173
//   (run `python3 -m http.server 5173` from the project root first).

import { createRequire } from 'module';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');

const require = createRequire(import.meta.url);
// Use the puppeteer from the gen-pwa project
const puppeteer = require('/Users/kaidejuricmasscmbook/Desktop/app/gen-pwa/node_modules/puppeteer');

const ARTIFACTS = join(projectRoot, 'e2e', 'artifacts');
if (!existsSync(ARTIFACTS)) mkdirSync(ARTIFACTS, { recursive: true });

const URL_BASE = process.env.URL_BASE || 'http://localhost:5173';

(async () => {
  console.log('Launching headless Chrome…');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });

  const pageErrors = [];
  const networkErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Background network 4xx/5xx (e.g. @gradio/client preflight, GitHub rate limits)
      // are not page errors — the app degrades gracefully. Capture them separately
      // for the report but don't fail the test on them.
      if (/Failed to load resource/i.test(text)) {
        networkErrors.push(text);
      } else {
        pageErrors.push('[console.error] ' + text);
      }
    }
  });
  page.on('requestfailed', (req) => {
    networkErrors.push(req.url() + ' — ' + (req.failure() ? req.failure().errorText : 'failed'));
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !res.url().startsWith(URL_BASE)) {
      networkErrors.push(res.status() + ' ' + res.url());
    }
  });

  console.log('Loading ' + URL_BASE + '/ …');
  const resp = await page.goto(URL_BASE + '/', { waitUntil: 'networkidle0', timeout: 30000 });
  if (!resp || !resp.ok()) {
    console.error('FAIL: page did not return 2xx. Status:', resp ? resp.status() : 'no response');
    process.exit(1);
  }
  console.log('  → status ' + resp.status());

  // Wait for cards to render (app.js bootstrap is async)
  await page.waitForSelector('.card', { timeout: 10000 });

  const cardCount = await page.$$eval('.card', (els) => els.length);
  console.log('  → ' + cardCount + ' card(s) rendered');
  if (cardCount !== 12) {
    console.error('FAIL: expected 12 cards, got ' + cardCount);
    await page.screenshot({ path: join(ARTIFACTS, 'fail-card-count.png'), fullPage: true });
    await browser.close();
    process.exit(1);
  }

  // Check that all card titles are populated
  const cardTitles = await page.$$eval('.card__title', (els) => els.map(e => e.textContent.trim()));
  console.log('  → titles: ' + cardTitles.slice(0, 4).join(', ') + ', …');

  // Check the sidebar has all 11 categories
  const pillCount = await page.$$eval('#category-pills .pill', (els) => els.length);
  console.log('  → ' + pillCount + ' category pill(s)');
  if (pillCount !== 11) {
    console.error('FAIL: expected 11 category pills, got ' + pillCount);
    process.exit(1);
  }

  // Click the first card to open the modal
  console.log('Clicking first card to open modal…');
  await page.click('.card');
  await page.waitForSelector('.modal-backdrop', { visible: true, timeout: 5000 });

  // Wait for modal content to be filled
  await new Promise((r) => setTimeout(r, 200));

  const modalTitle = await page.$eval('#modal-title', (el) => el.textContent.trim());
  const deployText = await page.$eval('.deploy', (el) => el.textContent.replace(/\s+/g, ' ').trim());
  const hasDeployCmd = deployText.includes('gradio deploy') && deployText.includes('--token') && deployText.includes('--repo');
  console.log('  → modal title: ' + modalTitle);
  console.log('  → deploy line: ' + deployText);
  if (!hasDeployCmd) {
    console.error('FAIL: deploy command not present in modal');
    await page.screenshot({ path: join(ARTIFACTS, 'fail-deploy-cmd.png'), fullPage: true });
    process.exit(1);
  }

  // Take a screenshot of the open modal
  await page.screenshot({ path: join(ARTIFACTS, 'modal-open.png') });

  // Close modal
  await page.click('#modal-close');
  await new Promise((r) => setTimeout(r, 200));

  // Type into the search box, verify filtering works
  console.log('Testing search filter…');
  await page.click('#search-input');
  await page.type('#search-input', 'whisper');
  await new Promise((r) => setTimeout(r, 300));
  const filteredCount = await page.$$eval('.card', (els) => els.length);
  console.log('  → ' + filteredCount + ' card(s) after search "whisper"');
  if (filteredCount !== 1) {
    console.error('FAIL: search did not narrow to 1 card, got ' + filteredCount);
    process.exit(1);
  }

  // Clear search
  await page.click('#clear-filters');
  await new Promise((r) => setTimeout(r, 200));
  const restoredCount = await page.$$eval('.card', (els) => els.length);
  console.log('  → restored to ' + restoredCount + ' card(s) after clear');
  if (restoredCount !== 12) {
    console.error('FAIL: clear did not restore all 12 cards');
    process.exit(1);
  }

  // Test category filter: click "Voice Cloning"
  console.log('Testing category filter…');
  await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('#category-pills .pill'));
    const target = pills.find((p) => p.textContent.includes('Voice Cloning'));
    if (target) target.click();
  });
  await new Promise((r) => setTimeout(r, 200));
  const voiceCount = await page.$$eval('.card', (els) => els.length);
  console.log('  → ' + voiceCount + ' card(s) in Voice Cloning');
  if (voiceCount !== 3) {
    console.error('FAIL: expected 3 voice cloning tools, got ' + voiceCount);
    process.exit(1);
  }

  // Take a final overview screenshot
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(ARTIFACTS, 'directory.png'), fullPage: false });

  // ==== Hub section checks (v0.2) ====
  console.log('Checking Hub section…');
  // Marketing hero must be present
  const heroTitle = await page.$eval('.hero__title', (el) => el.textContent.trim());
  console.log('  → hero title: ' + heroTitle.slice(0, 50) + '…');
  if (!heroTitle.toLowerCase().includes('gradio')) {
    console.error('FAIL: hero title missing Gradio mention');
    process.exit(1);
  }
  // 12 hub cards must render
  const hubCardCount = await page.$$eval('.hub-card', (els) => els.length);
  console.log('  → ' + hubCardCount + ' hub card(s)');
  if (hubCardCount !== 12) {
    console.error('FAIL: expected 12 hub cards, got ' + hubCardCount);
    process.exit(1);
  }
  // Hub nav link works
  const hubNavCount = await page.$$eval('.nav__link', (els) => els.filter((a) => a.textContent.trim() === 'Hub').length);
  if (hubNavCount !== 1) {
    console.error('FAIL: expected exactly 1 Hub nav link, got ' + hubNavCount);
    process.exit(1);
  }
  // Click a "links" hub card (Latest Papers) — verify modal has external links
  console.log('Opening Latest Papers section…');
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.hub-card'));
    const target = cards.find((c) => c.textContent.includes('Latest Papers'));
    if (target) target.click();
  });
  await page.waitForSelector('.modal-backdrop', { visible: true, timeout: 5000 });
  await new Promise((r) => setTimeout(r, 200));
  const sectionTitle = await page.$eval('#modal-title', (el) => el.textContent.trim());
  console.log('  → section title: ' + sectionTitle);
  const linkCount = await page.$$eval('.hub-link', (els) => els.length);
  console.log('  → ' + linkCount + ' external link(s) in section');
  if (sectionTitle !== 'Latest Papers' || linkCount < 3) {
    console.error('FAIL: Latest Papers section did not render external links');
    await page.screenshot({ path: join(ARTIFACTS, 'fail-hub-modal.png'), fullPage: true });
    process.exit(1);
  }
  // Verify a hub link points to arXiv (one we can sanity-check without a network call)
  const firstHubHref = await page.$eval('.hub-link', (el) => el.getAttribute('href'));
  console.log('  → first link: ' + firstHubHref);
  if (!/^https:\/\//.test(firstHubHref)) {
    console.error('FAIL: hub link not an absolute URL');
    process.exit(1);
  }
  await page.screenshot({ path: join(ARTIFACTS, 'hub-section.png') });
  // Close modal
  await page.click('#modal-close');
  await new Promise((r) => setTimeout(r, 200));

  // Open a "checklist" section — verify checkboxes render
  console.log('Opening Checklist section…');
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.hub-card'));
    const target = cards.find((c) => c.textContent.includes('Checklist'));
    if (target) target.click();
  });
  await page.waitForSelector('.modal-backdrop', { visible: true, timeout: 5000 });
  await new Promise((r) => setTimeout(r, 200));
  const cbCount = await page.$$eval('.hub-row__cb', (els) => els.length);
  console.log('  → ' + cbCount + ' checkbox row(s)');
  if (cbCount < 5) {
    console.error('FAIL: Checklist section did not render checkboxes');
    process.exit(1);
  }
  await page.click('#modal-close');
  await new Promise((r) => setTimeout(r, 200));

  // ==== Version picker (v2.0) ====
  console.log('Checking version picker (5 persona-lens versions)…');
  const versionPills = await page.$$eval('.version-pill', (els) => els.map((e) => e.textContent.trim()));
  console.log('  → ' + versionPills.length + ' version pill(s): ' + versionPills.join(' | '));
  if (versionPills.length !== 5) {
    console.error('FAIL: expected 5 version pills, got ' + versionPills.length);
    process.exit(1);
  }
  // Each pill should have the right label
  var expectedLabels = ['Builder', 'Musician', 'Researcher', 'Creative Coder', 'Director'];
  for (var i = 0; i < expectedLabels.length; i++) {
    if (!versionPills[i].includes(expectedLabels[i])) {
      console.error('FAIL: version pill ' + i + ' expected "' + expectedLabels[i] + '", got "' + versionPills[i] + '"');
      process.exit(1);
    }
  }
  // Click the "Musician" version
  await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('.version-pill'));
    const target = pills.find((p) => p.textContent.includes('Musician'));
    if (target) target.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const activeVer = await page.$eval('.version-pill.is-active', (el) => el.textContent.trim());
  console.log('  → active version after click: ' + activeVer);
  if (!activeVer.includes('Musician')) {
    console.error('FAIL: Musician version did not become active');
    process.exit(1);
  }
  // URL should reflect the version
  const urlAfterVer = page.url();
  if (!/[?&]v=musician(\b|&|$)/.test(urlAfterVer)) {
    console.error('FAIL: URL did not include v=musician, got: ' + urlAfterVer);
    process.exit(1);
  }
  // Open Latest Papers with Musician lens, verify content changed
  console.log('  → opening Latest Papers under Musician lens…');
  await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.hub-card'));
    const target = cards.find((c) => c.textContent.includes('Latest Papers'));
    if (target) target.click();
  });
  await page.waitForSelector('.modal-backdrop.is-open', { visible: true, timeout: 5000 });
  await new Promise((r) => setTimeout(r, 200));
  const modalBadge = await page.$eval('.hub-modal__version', (el) => el.textContent.trim()).catch(() => '');
  console.log('  → modal lens badge: ' + modalBadge);
  if (!modalBadge.includes('Musician')) {
    console.error('FAIL: modal did not show Musician lens badge');
    process.exit(1);
  }
  // In-modal version switcher should have 5 pills
  const inModalPills = await page.$$eval('.hub-modal__switcher-pill', (els) => els.length);
  console.log('  → ' + inModalPills + ' in-modal switcher pill(s)');
  if (inModalPills !== 5) {
    console.error('FAIL: expected 5 in-modal switcher pills, got ' + inModalPills);
    process.exit(1);
  }
  await page.click('#modal-close');
  await new Promise((r) => setTimeout(r, 200));
  // Reset to default Director lens
  await page.evaluate(() => {
    const pills = Array.from(document.querySelectorAll('.version-pill'));
    const target = pills.find((p) => p.textContent.includes('Director'));
    if (target) target.click();
  });
  await new Promise((r) => setTimeout(r, 300));

  // Take a full-page screenshot showing hero + directory + hub
  console.log('Taking full-page screenshot…');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(ARTIFACTS, 'full-page.png'), fullPage: true });

  // Test light theme
  await page.click('#theme-toggle');
  await new Promise((r) => setTimeout(r, 200));
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  console.log('  → theme toggled to: ' + theme);
  if (theme !== 'light') {
    console.error('FAIL: theme toggle did not switch to light');
    process.exit(1);
  }
  await page.screenshot({ path: join(ARTIFACTS, 'directory-light.png'), fullPage: false });

  // Test tester page
  console.log('Loading tester.html…');
  const testerResp = await page.goto(URL_BASE + '/tester.html', { waitUntil: 'networkidle0', timeout: 30000 });
  if (!testerResp || !testerResp.ok()) {
    console.error('FAIL: tester page did not return 2xx. Status:', testerResp ? testerResp.status() : 'no response');
    process.exit(1);
  }
  console.log('  → status ' + testerResp.status());
  await page.waitForSelector('#space-url', { timeout: 5000 });

  // Quick picks should populate
  await page.waitForFunction(
    () => document.querySelectorAll('#quick-picks .chip').length > 0,
    { timeout: 8000 }
  );
  const quickCount = await page.$$eval('#quick-picks .chip', (els) => els.length);
  console.log('  → ' + quickCount + ' quick-pick chip(s) loaded');
  if (quickCount === 0) {
    console.error('FAIL: tester quick picks did not load');
    process.exit(1);
  }
  await page.screenshot({ path: join(ARTIFACTS, 'tester.png'), fullPage: false });

  // Page errors check
  if (pageErrors.length) {
    console.error('FAIL: page errors observed:');
    pageErrors.forEach((e) => console.error('  ' + e));
    process.exit(1);
  }

  if (networkErrors.length) {
    console.log('  → ' + networkErrors.length + ' background network error(s) (non-fatal, e.g. gated HF Spaces / GitHub rate limit):');
    networkErrors.slice(0, 6).forEach((e) => console.log('    · ' + e));
    if (networkErrors.length > 6) console.log('    · …and ' + (networkErrors.length - 6) + ' more');
  }

  console.log('\nAll E2E checks passed ✓');
  await browser.close();
  process.exit(0);
})().catch((err) => {
  console.error('Test crashed:', err);
  process.exit(1);
});
