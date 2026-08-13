#!/usr/bin/env node
// E2E for the new HF token + one-click deploy flow
import puppeteer from 'puppeteer';
import { mkdir } from 'node:fs/promises';

const BASE = 'https://kaidjuric-gradio-pipeline-directory.static.hf.space';
const ART = '/Users/kaidejuricmasscmbook/.minimax/workspace/gradio-pipeline-directory/e2e/artifacts';
await mkdir(ART, { recursive: true });

const log = (...a) => console.log('[e2e]', ...a);
let failed = 0;
const fail = (m) => { console.error('  ❌', m); failed++; };
const pass = (m) => console.log('  ✅', m);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

log(`Testing HF deploy flow: ${BASE}`);

// 1) Page loads
const resp = await page.goto(BASE + '/', { waitUntil: 'networkidle2', timeout: 60000 });
if (resp.status() !== 200) fail(`Index returned ${resp.status()}`); else pass('Index 200');

// 2) HFDeploy module is loaded
const hasHFDeploy = await page.evaluate(() => typeof window.HFDeploy === 'object' && window.HFDeploy !== null);
if (!hasHFDeploy) fail('window.HFDeploy not loaded'); else pass('HFDeploy module loaded');

// 3) HF pill button visible
const pillVisible = await page.$('#hf-pill-toggle');
if (!pillVisible) fail('HF pill button not found'); else pass('HF pill button visible');

// 4) "Deploy model" button visible
const deployModelBtn = await page.$('#deploy-model-btn');
if (!deployModelBtn) fail('Deploy model button not found'); else pass('Deploy model button visible');

// 5) Click HF pill → panel opens
await page.click('#hf-pill-toggle');
await new Promise(r => setTimeout(r, 200));
const panelVisible = await page.evaluate(() => !document.getElementById('hf-pill-panel').hidden);
if (!panelVisible) fail('HF pill panel did not open'); else pass('HF pill panel opens');
await page.screenshot({ path: ART + '/hf-deploy-pill-open.png' });

// 6) Click outside → panel closes
await page.evaluate(() => {
  // Dispatch a real click on the body (not the pill) — more reliable than page.click
  const body = document.body;
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true, view: window });
  Object.defineProperty(evt, 'target', { value: body, enumerable: true });
  body.dispatchEvent(evt);
});
await new Promise(r => setTimeout(r, 200));
const panelClosed = await page.evaluate(() => document.getElementById('hf-pill-panel').hidden);
if (!panelClosed) fail('HF pill panel did not close on outside click'); else pass('Click-outside closes panel');

// 7) Open a card modal → deploy section injected
await page.waitForSelector('#results .card');
await page.click('#results .card');
await page.waitForSelector('#modal:not([hidden])', { timeout: 5000 });
const deploySectionExists = await page.$('.modal__section--deploy');
if (!deploySectionExists) fail('Deploy section not injected in modal'); else pass('Deploy section injected in tool modal');
const deployBtn = await page.$('#deploy-now-btn');
if (!deployBtn) fail('Deploy button not found in modal'); else pass('Deploy button present in modal');
await page.screenshot({ path: ART + '/hf-deploy-modal.png' });

// 8) Click deploy with no token → should prompt for token
await page.click('#deploy-now-btn');
await new Promise(r => setTimeout(r, 300));
const errMsg = await page.$eval('#deploy-result', el => el.textContent);
if (!/Add your HF token/i.test(errMsg)) fail(`Expected token prompt, got: ${errMsg}`);
else pass('No-token deploy shows token prompt');
const hasLinkToPill = await page.$('#deploy-open-pill');
if (hasLinkToPill) pass('Prompt includes link to open token pill'); else fail('No link to open token pill');

// 9) Close modal, click "Deploy model" → model modal opens
await page.click('#modal-close');
await new Promise(r => setTimeout(r, 200));
await page.click('#deploy-model-btn');
await new Promise(r => setTimeout(r, 300));
const modelModalOpen = await page.evaluate(() => !document.getElementById('model-modal').hidden);
if (!modelModalOpen) fail('Model deploy modal did not open'); else pass('Model deploy modal opens');
await page.screenshot({ path: ART + '/hf-deploy-model-modal.png' });

// 10) Click suggestion chip → fills model ID + space name
await page.click('#model-id-suggestions a[data-mid="stabilityai/stable-diffusion-xl-base-1.0"]');
await new Promise(r => setTimeout(r, 200));
const modelIdVal = await page.$eval('#model-id-input', el => el.value);
const spaceNameVal = await page.$eval('#model-space-name', el => el.value);
if (modelIdVal !== 'stabilityai/stable-diffusion-xl-base-1.0') fail(`Model ID not set: ${modelIdVal}`);
else pass('Model ID suggestion chip fills input');
if (!/^my-/.test(spaceNameVal)) fail(`Space name auto-fill failed: ${spaceNameVal}`);
else pass(`Space name auto-filled: ${spaceNameVal}`);

// 11) Invalid model ID format → error (seed a fake token in localStorage so the format check runs)
await page.evaluate(() => {
  localStorage.setItem('gpd:hf-token', 'hf_fakeForFormatValidationTestOnly');
  localStorage.setItem('gpd:hf-user', JSON.stringify({ name: 'tester' }));
  // Force the HFDeploy module to reload from storage by re-initializing in the page
  if (window.HFDeploy) {
    // Easiest: re-evaluate the module would re-run the IIFE. But we have a cached module.
    // Just call setToken which both validates (will 401) and updates state. But that breaks the test.
    // Better: directly poke the state via a known path. The module exposes a way to read user.
    // The cleanest approach: set up state in localStorage and reload.
  }
});
// Easiest path: reload the page so the IIFE re-reads localStorage
await page.reload({ waitUntil: 'networkidle2' });
// Re-open the model modal
await page.click('#deploy-model-btn');
await new Promise(r => setTimeout(r, 300));
await page.evaluate(() => { document.getElementById('model-id-input').value = 'not-a-valid-id'; });
await page.click('#model-deploy-btn');
await new Promise(r => setTimeout(r, 300));
const validationErr = await page.$eval('#model-progress-result', el => el.textContent);
if (!/owner\/name format/i.test(validationErr)) fail(`Expected format error, got: ${validationErr}`);
else pass('Invalid model ID format is caught');
// Clean up the fake token
await page.evaluate(() => { localStorage.removeItem('gpd:hf-token'); localStorage.removeItem('gpd:hf-user'); });

// 12) Close model modal
await page.click('#model-modal-close');
await new Promise(r => setTimeout(r, 200));
const modelModalClosed = await page.evaluate(() => document.getElementById('model-modal').hidden);
if (!modelModalClosed) fail('Model modal did not close'); else pass('Model modal closes on ×');

// 13) Token validation: try a malformed token
await page.click('#hf-pill-toggle');
await new Promise(r => setTimeout(r, 200));
await page.evaluate(() => { document.getElementById('hf-token-input').value = 'not-a-token'; });
await page.click('#hf-token-save');
await new Promise(r => setTimeout(r, 400));
const tokenStatus = await page.$eval('#hf-token-status', el => el.textContent);
if (!/must look like hf_/i.test(tokenStatus)) fail(`Expected format error, got: ${tokenStatus}`);
else pass('Malformed token rejected with format error');
await page.screenshot({ path: ART + '/hf-deploy-token-error.png' });

// 14) Real token validation: try a properly-formatted but invalid token
await page.evaluate(() => { document.getElementById('hf-token-input').value = 'hf_aaaaaaaaaaaaaaaaaaaaaaaaaa'; });
await page.click('#hf-token-save');
// Wait for whoami-v2 call
await new Promise(r => setTimeout(r, 4000));
const realStatus = await page.$eval('#hf-token-status', el => el.textContent);
if (!/(401|Validation failed|✕)/.test(realStatus)) fail(`Expected 401/error, got: ${realStatus}`);
else pass(`Real-format invalid token rejected (${realStatus.slice(0, 50)})`);

// 15) Console errors
const realErrors = consoleErrors.filter(e => !/favicon\.ico|404 \(Not Found\)|whoami-v2.*401|status of 401/i.test(e));
if (realErrors.length) fail(`Console errors:\n  ${realErrors.join('\n  ')}`);
else pass(`No real console errors (${consoleErrors.length} total)`);

// 16) Final screenshot
await page.goto(BASE + '/#hub', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 800));
await page.screenshot({ path: ART + '/hf-deploy-final.png', fullPage: false });
pass(`Final screenshot saved`);

await browser.close();
console.log(`\n${failed ? `❌ ${failed} TESTS FAILED` : '✅ ALL TESTS PASSED'}`);
process.exit(failed ? 1 : 0);
