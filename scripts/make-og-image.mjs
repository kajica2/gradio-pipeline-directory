#!/usr/bin/env node
// Renders the social preview card (Open Graph / Twitter card) for the
// directory's landing page.
//
// Why this exists: the live site had og:title / og:description / og:url but
// NO og:image, so any link shared to X / LinkedIn / Slack / iMessage rendered
// as a bare text row with no preview artwork. Twitter and LinkedIn both fall
// back to a plain-text card when og:image is missing, which reads as an
// unfinished product for something that is meant to be a marketing surface.
//
// The card is drawn in the site's own design tokens (shared/styles.css) so
// the preview matches the page it links to. It is rendered with the same
// headless Chrome the e2e suites use, so there is no image-library
// dependency and no second rendering path to keep in sync.
//
// Usage:
//   node scripts/make-og-image.mjs
//   -> writes assets/img/og.png (1200x630, PNG)
//
// Re-run it whenever the brand mark, headline or design tokens change, then
// commit the regenerated PNG alongside the meta tags that reference it.

import { launch } from '../e2e/browser.mjs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const OUT = join(ROOT, 'assets', 'img', 'og.png');

const WIDTH = 1200;
const HEIGHT = 630;

// Design tokens mirrored from shared/styles.css :root. Kept inline (rather
// than linked) because the page is rendered with a file:// URL and the
// stylesheet is not part of the document.
const T = {
  bg: '#0a0b10',
  surface: '#11131a',
  surface2: '#161922',
  border: '#232634',
  borderStrong: '#2f3447',
  text: '#e8eaf2',
  dim: '#9ea4b8',
  faint: '#6b7187',
  accent: '#7dd3c0',
  accent2: '#5fb8a4',
  codeBg: '#0d0f15',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  sans: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
};

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${WIDTH}px; height: ${HEIGHT}px; }
  body {
    background: ${T.bg};
    color: ${T.text};
    font-family: ${T.sans};
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 56px 64px 48px;
    position: relative;
    overflow: hidden;
  }
  /* Ambient teal glow, top-right — echoes the accent-glow token. */
  body::before {
    content: "";
    position: absolute;
    width: 760px; height: 760px;
    top: -420px; right: -180px;
    background: radial-gradient(circle, rgba(125,211,192,0.16) 0%, rgba(125,211,192,0) 68%);
    pointer-events: none;
  }
  /* Faint grid texture so the card does not read as a flat rectangle. */
  body::after {
    content: "";
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,0.022) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.022) 1px, transparent 1px);
    background-size: 48px 48px;
    mask-image: radial-gradient(ellipse at 50% 40%, #000 20%, transparent 78%);
    pointer-events: none;
  }
  .row { display: flex; align-items: center; gap: 16px; }
  .mark {
    width: 62px; height: 62px; border-radius: 16px;
    background: linear-gradient(135deg, ${T.accent} 0%, ${T.accent2} 100%);
    color: ${T.bg};
    display: grid; place-items: center;
    font-family: ${T.mono}; font-weight: 800; font-size: 34px;
    letter-spacing: -0.02em;
    box-shadow: 0 10px 34px rgba(125,211,192,0.26);
  }
  .brand { font-size: 25px; font-weight: 700; letter-spacing: -0.015em; }
  .brand span { color: ${T.accent}; }
  .tagline { font-size: 16px; color: ${T.dim}; margin-top: 3px; }

  .mid { position: relative; }
  h1 {
    font-size: 63px; line-height: 1.08; letter-spacing: -0.032em;
    font-weight: 800;
  }
  h1 em { font-style: normal; color: ${T.accent}; }
  .sub {
    margin-top: 20px; font-size: 23px; color: ${T.dim};
    line-height: 1.44; max-width: 46ch;
  }
  .sub b { color: ${T.text}; font-weight: 600; }

  .cmd {
    margin-top: 30px;
    background: ${T.codeBg};
    border: 1px solid ${T.borderStrong};
    border-radius: 12px;
    padding: 17px 22px;
    font-family: ${T.mono}; font-size: 18px;
    color: ${T.dim};
    display: inline-block;
    max-width: 100%;
  }
  .cmd .g { color: ${T.accent}; }
  .cmd .t { color: ${T.text}; }

  .stats { display: flex; gap: 12px; position: relative; }
  .chip {
    border: 1px solid ${T.border};
    background: ${T.surface};
    border-radius: 999px;
    padding: 9px 18px;
    font-size: 16px; color: ${T.dim};
    display: flex; align-items: center; gap: 9px;
  }
  .chip b { color: ${T.text}; font-weight: 600; }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: ${T.accent}; }
  .foot {
    position: relative;
    font-family: ${T.mono}; font-size: 15px; color: ${T.faint};
  }
</style></head>
<body>
  <div class="row">
    <div class="mark">G</div>
    <div>
      <div class="brand">Gradio Pipeline <span>Directory</span></div>
      <div class="tagline">Zero-setup deploys to Hugging Face Spaces</div>
    </div>
  </div>

  <div class="mid">
    <h1>Ship a Gradio app<br>in <em>60 seconds</em>.</h1>
    <div class="sub">Discover open-source audio &amp; video pipelines, then deploy any of them to a <b>free public Space</b> — no clone, no local Python, no GPU.</div>
    <div class="cmd"><span class="g">$</span> HF_TOKEN=hf_•••• <span class="t">gradio deploy</span></div>
  </div>

  <div class="row" style="justify-content: space-between; align-items: flex-end;">
    <div class="stats">
      <div class="chip"><span class="dot"></span><b>12</b> deployable tools</div>
      <div class="chip"><span class="dot"></span><b>60</b> curated blocks</div>
      <div class="chip"><span class="dot"></span><b>5</b> persona lenses</div>
    </div>
    <div class="foot">kajica2.github.io/gradio-pipeline-directory</div>
  </div>
</body></html>`;

await mkdir(dirname(OUT), { recursive: true });

const browser = await launch();
try {
  const page = await browser.newPage();
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, type: 'png' });
  console.log('wrote', OUT);
} finally {
  await browser.close();
}
