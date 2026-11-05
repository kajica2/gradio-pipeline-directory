#!/usr/bin/env node
// Puppeteer e2e: accessibility regression suite.
//
// Locks in the fixes for the four Lighthouse accessibility failures that
// were live on the deployed site:
//
//   1. color-contrast        — the --text-faint token sat at 3.63:1 on the
//                              raised panels, under the 4.5:1 AA floor.
//   2. label-content-name-mismatch — every card carried role="button" plus an
//                              aria-label that did not contain its visible text.
//   3. link-in-text-block   — the in-paragraph HF token link was
//                              distinguishable by colour alone (1.46:1).
//   4. target-size          — the "View on GitHub" link was a 16.5px-tall
//                              text run, under the 24x24 WCAG 2.2 minimum.
//
// It also covers the "agent-accessibility-tree" audit: an <article> holding
// role="button" plus real <a>/<button> children produces a malformed
// accessibility tree, which is what dropped Agentic Browsing to 50.
//
// Usage:
//   node e2e/a11y.mjs                 # boots its own server on a free port
//   A11Y_BASE=https://host/ node e2e/a11y.mjs   # against a deployed mirror
import { launch } from './browser.mjs';
import { startServer, assertThisSite, PROJECT_ROOT } from './serve.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = process.env.A11Y_BASE ? null : await startServer();
const BASE = process.env.A11Y_BASE || server.base;
if (server) {
  console.log(`[a11y] Serving ${PROJECT_ROOT} at ${BASE}`);
  process.on('exit', () => server.stop());
}

const ART = join(dirname(fileURLToPath(import.meta.url)), 'artifacts');
await mkdir(ART, { recursive: true });

const log = (...a) => console.log('[a11y]', ...a);
let failures = 0;
const fail = (msg) => { console.error('  ❌', msg); failures++; };
const pass = (msg) => console.log('  ✅', msg);

const browser = await launch();
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });
page.setDefaultNavigationTimeout(60000);
page.setDefaultTimeout(20000);

// Refuse to audit a port that is serving some other project.
{
  const title = await assertThisSite(BASE, '/');
  log(`Identity check OK — serving "${title}"`);
}

// ---------------------------------------------------------------------------
// Page-side helpers. Injected once, reused for every theme.
// ---------------------------------------------------------------------------
const HELPERS = `
  function srgb(c) {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function parseRGB(str) {
    const m = str.match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(/[,\\s\\/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum({ r, g, b }) {
    return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  }
  function over(fg, bg) {
    const a = fg.a;
    return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
  }
  function contrast(fg, bg) {
    const l1 = lum(fg), l2 = lum(bg);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function effectiveBg(el) {
    let node = el, acc = null;
    while (node && node.nodeType === 1) {
      const cs = getComputedStyle(node);
      if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; // cannot resolve
      const c = parseRGB(cs.backgroundColor);
      if (c && c.a > 0) {
        acc = acc === null ? c : over(acc, c);
        if (acc.a >= 1) return acc;
      }
      node = node.parentElement;
    }
    return acc || { r: 255, g: 255, b: 255, a: 1 };
  }
  function visibleText(el) {
    let out = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        if (n.getAttribute('aria-hidden') === 'true') continue;
        if (n.tagName === 'IMG' || n.tagName === 'SVG') continue;
        out += visibleText(n);
      }
    }
    return out.replace(/\\s+/g, ' ').trim();
  }
`;

// ---------------------------------------------------------------------------
// 1) Contrast, in both themes
// ---------------------------------------------------------------------------
log(`Checking contrast in both themes @ ${BASE}`);

for (const theme of ['dark', 'light']) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#results .card', { timeout: 15000 });
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
  await new Promise((r) => setTimeout(r, 250));

  const offenders = await page.evaluate(`(() => {
    ${HELPERS}
    const out = [];
    const seen = new Set();
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      const txt = visibleText(el);
      if (!txt) continue;
      // Only judge elements whose own text is the visible text (leaf-ish).
      const hasElementChildText = Array.from(el.children).some(c => visibleText(c));
      if (hasElementChildText) continue;
      const bg = effectiveBg(el);
      if (!bg) continue;
      const fg = parseRGB(cs.color);
      if (!fg) continue;
      const fgSolid = fg.a < 1 ? over(fg, bg) : fg;
      const size = parseFloat(cs.fontSize);
      const weight = Number(cs.fontWeight) || 400;
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      const ratio = contrast(fgSolid, bg);
      if (ratio < need) {
        const key = cs.color + '|' + ratio.toFixed(2);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
          sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).join('.') : ''),
          txt: txt.slice(0, 40), ratio: Math.round(ratio * 100) / 100, need,
          fg: cs.color, size, weight
        });
      }
    }
    return out;
  })()`);

  if (offenders.length === 0) {
    pass(`${theme} theme: every text node clears WCAG AA contrast`);
  } else {
    fail(`${theme} theme: ${offenders.length} low-contrast text node(s)`);
    for (const o of offenders.slice(0, 12)) {
      console.error(`      ${o.sel} — ${o.ratio}:1 (needs ${o.need}:1) ${o.size}px/${o.weight} "${o.txt}" fg=${o.fg}`);
    }
  }
}

// ---------------------------------------------------------------------------
// 2) Accessible names must contain the visible text (label-content-name-mismatch)
// ---------------------------------------------------------------------------
log('Checking accessible names contain their visible text…');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#results .card', { timeout: 15000 });

const nameMismatches = await page.evaluate(`(() => {
  ${HELPERS}
  // axe's label-content-name-mismatch only applies to elements that carry a
  // user-facing label (controls). Group containers such as <nav aria-label>
  // or <ul aria-label> are labelled regions, not mislabelled controls.
  const CONTROL = 'button, a[href], input, select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"]';
  const out = [];
  for (const el of document.querySelectorAll(CONTROL)) {
    const name = (el.getAttribute('aria-label') || '').trim();
    if (!name) continue;
    const txt = visibleText(el);
    if (!txt) continue;
    // A visible label made only of symbols ("×", "→", an emoji) carries no
    // word to match, so axe skips it.
    if (!/[\\p{L}\\p{N}]/u.test(txt)) continue;
    const n = name.toLowerCase(), t = txt.toLowerCase();
    if (!n.includes(t) && !t.includes(n)) {
      out.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60), name, txt: txt.slice(0, 50) });
    }
  }
  return out;
})()`);

if (nameMismatches.length === 0) pass('every aria-label contains its visible text');
else {
  fail(`${nameMismatches.length} accessible-name mismatch(es)`);
  for (const m of nameMismatches.slice(0, 10)) console.error(`      ${m.tag}.${m.cls} name="${m.name}" visible="${m.txt}"`);
}

// ---------------------------------------------------------------------------
// 3) No role="button" on a container that holds other controls
//    (this is what made the accessibility tree malformed)
// ---------------------------------------------------------------------------
log('Checking interactive-role nesting…');
const nestedRoles = await page.evaluate(`(() => {
  const out = [];
  for (const el of document.querySelectorAll('[role="button"]')) {
    if (el.querySelector('a, button, input, select, textarea, [role="button"]')) {
      out.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 60) });
    }
  }
  return out;
})()`);
if (nestedRoles.length === 0) pass('no role="button" wraps another control');
else {
  fail(`${nestedRoles.length} nested interactive control(s)`);
  for (const n of nestedRoles.slice(0, 10)) console.error(`      ${n.tag}.${n.cls}`);
}

// ---------------------------------------------------------------------------
// 4) Card title is a real button and still opens the modal
// ---------------------------------------------------------------------------
log('Checking card title button semantics…');
const titleBtn = await page.evaluate(() => {
  const b = document.querySelector('#results .card__title-btn');
  if (!b) return null;
  return {
    tag: b.tagName.toLowerCase(),
    type: b.getAttribute('type'),
    haspopup: b.getAttribute('aria-haspopup'),
    text: b.textContent.trim(),
  };
});
if (!titleBtn) fail('card title is not a <button>');
else if (titleBtn.tag !== 'button') fail(`card title is <${titleBtn.tag}>, expected <button>`);
else if (titleBtn.haspopup !== 'dialog') fail(`card title button aria-haspopup="${titleBtn.haspopup}", expected "dialog"`);
else pass(`card title is a real <button> ("${titleBtn.text}") with aria-haspopup="dialog"`);

const hubTitleBtn = await page.evaluate(() => {
  const b = document.querySelector('#hub-grid .hub-card__title-btn');
  return b ? { tag: b.tagName.toLowerCase(), haspopup: b.getAttribute('aria-haspopup') } : null;
});
if (!hubTitleBtn) fail('hub card title is not a <button>');
else if (hubTitleBtn.tag !== 'button' || hubTitleBtn.haspopup !== 'dialog') fail(`hub title button wrong: ${JSON.stringify(hubTitleBtn)}`);
else pass('hub card title is a real <button> with aria-haspopup="dialog"');

// Keyboard path: tab to the title button and press Enter -> modal opens.
await page.evaluate(() => document.querySelector('#results .card__title-btn').focus());
await page.keyboard.press('Enter');
await page.waitForSelector('.modal-backdrop', { visible: true, timeout: 5000 }).catch(() => {});
const modalOpen = await page.evaluate(() => !!document.querySelector('.modal-backdrop.is-open, .modal-backdrop[style*=""]') && !document.querySelector('#modal').hidden);
if (modalOpen) pass('Enter on the card title button opens the detail modal');
else fail('Enter on the card title button did not open the modal');
await page.evaluate(() => { const b = document.querySelector('#modal-close'); if (b) b.click(); });
await new Promise((r) => setTimeout(r, 200));

// ---------------------------------------------------------------------------
// 5) Touch target size (WCAG 2.2 — 24x24 CSS px)
// ---------------------------------------------------------------------------
log('Checking touch target sizes…');
const smallTargets = await page.evaluate(`(() => {
  const out = [];
  const sel = 'a.card__link, button.card__deploy, .hub-card__title-btn, a.hub-link';
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.height < 24) out.push({ sel: el.className || el.tagName, w: Math.round(r.width), h: Math.round(r.height) });
  }
  return out;
})()`);
if (smallTargets.length === 0) pass('all card/hub controls are at least 24px tall');
else {
  fail(`${smallTargets.length} control(s) under the 24px target size`);
  for (const t of smallTargets.slice(0, 10)) console.error(`      ${t.sel} — ${t.w}x${t.h}px`);
}

// ---------------------------------------------------------------------------
// 6) Links in a text block must not rely on colour alone
// ---------------------------------------------------------------------------
log('Checking in-paragraph links are underlined…');
const colorOnlyLinks = await page.evaluate(`(() => {
  const out = [];
  for (const a of document.querySelectorAll('.notice a, .notice p a')) {
    const cs = getComputedStyle(a);
    const decorated = cs.textDecorationLine && cs.textDecorationLine !== 'none';
    const weight = parseFloat(cs.fontWeight) || 400;
    if (!decorated && weight < 700) out.push({ href: a.getAttribute('href'), decoration: cs.textDecorationLine });
  }
  return out;
})()`);
if (colorOnlyLinks.length === 0) pass('in-paragraph links carry a non-colour cue');
else {
  fail(`${colorOnlyLinks.length} link(s) rely on colour alone`);
  for (const l of colorOnlyLinks) console.error(`      ${l.href} (text-decoration: ${l.decoration})`);
}

// ---------------------------------------------------------------------------
// 7) Deep links to hub sections (the sitemap depends on these)
// ---------------------------------------------------------------------------
log('Checking hub deep links…');
await page.goto(BASE + '/#papers', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('#hub-grid .hub-card', { timeout: 15000 });
await new Promise((r) => setTimeout(r, 900));
const deepLink = await page.evaluate(() => {
  const el = document.getElementById('papers');
  if (!el) return { exists: false };
  const r = el.getBoundingClientRect();
  return { exists: true, inView: r.top < window.innerHeight && r.bottom > 0, top: Math.round(r.top) };
});
if (!deepLink.exists) fail('#papers anchor target does not exist');
else if (!deepLink.inView) fail(`#papers scrolled to ${deepLink.top}px — target is off-screen`);
else pass(`#papers resolves and scrolls into view (top=${deepLink.top}px)`);

// ---------------------------------------------------------------------------
// 8) robots.txt + sitemap.xml are served and well-formed
// ---------------------------------------------------------------------------
log('Checking robots.txt and sitemap.xml…');
for (const path of ['/robots.txt', '/sitemap.xml']) {
  const r = await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const body = await page.evaluate(() => document.body.innerText);
  if (r.status() !== 200) fail(`${path} returned ${r.status()}`);
  else if (path.endsWith('.xml') && !/<urlset[\s\S]*<loc>/.test(body)) fail(`${path} is not a valid sitemap`);
  else pass(`${path} returns 200 with usable content`);
}

// A sitemap URL must not point at an anchor that does not exist.
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
// The hub cards are rendered from a fetched JSON file, so they are not in the
// DOM yet at domcontentloaded — wait for them before checking the anchors.
await page.waitForSelector('#hub-grid .hub-card', { timeout: 15000 });
const sm = await page.evaluate(async () => {
  const xml = await (await fetch('sitemap.xml')).text();
  const locs = [...xml.matchAll(/<loc>([^#]+)(?:#([^<]+))?<\/loc>/g)].map(m => ({ url: m[1], hash: m[2] }));
  const missing = [];
  for (const l of locs) {
    if (!l.hash) continue;
    if (!document.getElementById(l.hash)) missing.push(l.hash);
  }
  return { total: locs.length, missing };
});
if (sm.missing.length === 0) pass(`all ${sm.total} sitemap URLs resolve to real anchors`);
else fail(`sitemap references ${sm.missing.length} missing anchor(s): ${sm.missing.join(', ')}`);

// ---------------------------------------------------------------------------
log('');
const failed = failures > 0;
if (!failed) {
  console.log('  ✅ ALL A11Y CHECKS PASSED');
} else {
  console.error(`  ❌ ${failures} a11y check(s) failed`);
}

await browser.close();

// Exit explicitly. A lingering CDP connection or the suite's own static
// server can keep the event loop alive after the last check, and a test
// runner that never returns is a hung CI job, not a passing one.
process.exit(failed ? 1 : 0);
