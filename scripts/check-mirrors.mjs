#!/usr/bin/env node
// Mirror parity check for the Gradio Pipeline Directory.
//
// Why this exists
// ---------------
// The site is published in three places (GitHub Pages, Vercel, an HF Space)
// and all three are supposed to serve the same bytes. The HF Space is the
// only one of the three that is NOT updated by `git push` -- it needs a
// manual sync (see the README) -- so it is the one that silently drifts.
//
// The drift is invisible to every other suite in this repo: `e2e/a11y.mjs`
// checks one origin, `e2e/live-verify.mjs` checks the deployed URL, and
// neither of them knows what the other two mirrors are serving. A served
// file edited and pushed to GitHub but never copied to the Space leaves the
// Space serving the previous revision, and every suite still passes.
//
// This script closes that gap: it fetches every served file from every
// mirror and compares it byte-for-byte against the working tree.
//
// The HF robots.txt shadow
// ------------------------
// Hugging Face's static-Space runtime serves its OWN robots.txt at /robots.txt
// and ignores the one committed to the Space repo. Verified 2026-11-07:
//   - the Space repo's robots.txt (fetched from the raw endpoint) is the
//     repo's 319-byte file with the Sitemap pointer;
//   - the Space's /robots.txt serves HF's 23-byte default
//     ("User-agent: *\nAllow: /");
//   - an unrelated public static Space (advafzal/afzal-space) with its own
//     custom robots.txt serves the same 23-byte default.
//
// So it is platform behaviour, not a sync gap, and pushing a different
// robots.txt does not change it. It is listed as a KNOWN SHADOW below and
// reported as information, not as a failure -- but it is still checked, so a
// future change to the platform (or to our robots.txt) is caught.
//
// Usage:
//     node scripts/check-mirrors.mjs
//     npm run e2e:mirrors
//
// Exits 0 when every mirror serves the working tree, 1 otherwise.

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const log = (...a) => console.log('[mirrors]', ...a);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

const MIRRORS = [
  { name: 'Pages', base: 'https://kajica2.github.io/gradio-pipeline-directory' },
  { name: 'Vercel', base: 'https://gradio-pipeline-directory.vercel.app' },
  { name: 'HF Space', base: 'https://kaidjuric-gradio-pipeline-directory.static.hf.space' },
];

// Everything the three mirrors serve. Keep this in step with the file list
// in the README's "The three live mirrors" section.
const FILES = [
  'index.html',
  'tester.html',
  'robots.txt',
  'sitemap.xml',
  'shared/styles.css',
  'shared/app.js',
  'shared/hf-deploy.js',
  'data/hub.json',
  'data/featured.json',
  'data/categories.json',
  'assets/img/og.png',
];

// The served asset graph, derived from the pages themselves by following the
// files they load. A file the site loads but that is missing from FILES is
// never compared against the mirrors, so it could go stale on the Space
// without the check noticing — which is the exact failure this check exists
// to prevent. `shared/hf-deploy.js` was such a file once: loaded by
// index.html, absent from FILES, and therefore silently uncovered.
//
// The surface is bounded on purpose. The site serves these directories and
// these root files; anything else in the repo (e2e/, scripts/, gradio-app/,
// package.json) is not served and so is not part of the graph. The bound also
// keeps out file *names* that the deploy flow mentions without loading —
// hf-deploy.js uploads a `requirements.txt` and an `app.py` to the user's own
// Space, and neither is a file this site fetches.
const SERVED_DIRS = ['shared/', 'data/', 'assets/'];
const SERVED_ROOT_FILES = ['index.html', 'tester.html', 'robots.txt', 'sitemap.xml'];

// Markup references only make sense in HTML; script references only make
// sense inside script bodies. Scanning either file with both patterns yields
// nonsense: app.js builds HTML strings, so `href="' + p.spaceUrl + '` inside
// a template literal looks like a markup reference but is not one.
const MARKUP_REF = /(?:href|src)\s*=\s*"([^"]+)"/g;
const SCRIPT_BLOCK = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
// Any string literal, not just `fetch('…')`: the site loads its data through
// a `loadJSON('data/hub.json')` helper, so a call-shaped pattern would miss
// the very files this guard is meant to watch.
const STRING_LITERAL = /'([^'\n]*)'|"([^"\n]*)"/g;

// A path to a file the site could load. Requiring a known extension keeps
// ordinary strings such as 'text/html' or 'hub' out of the graph.
const SERVED_EXT = /\.(?:html?|css|m?js|json|png|jpe?g|gif|webp|avif|svg|ico|txt|xml|webmanifest|woff2?)$/i;
const PLAIN_PATH = /^[A-Za-z0-9._\-/]+$/;

function normalizeRef(ref) {
  const clean = ref.split('#')[0].split('?')[0].replace(/^\.\//, '');
  if (!PLAIN_PATH.test(clean)) return null; // absolute URL, data: URI, or a code fragment
  return SERVED_EXT.test(clean) ? clean : null;
}

const isServedPath = (p) => SERVED_DIRS.some((d) => p.startsWith(d)) || SERVED_ROOT_FILES.includes(p);

async function exists(rel) {
  try {
    const info = await stat(join(ROOT, rel));
    return info.isFile();
  } catch {
    return false;
  }
}

// Pull the local file references out of one file. Markup attributes come from
// HTML; string literals come from script bodies and from .js files.
function refsOf(path, text) {
  const refs = new Set();
  if (path.endsWith('.html')) {
    // Markup with script bodies removed — the opening tag stays, so an
    // external `<script src="…">` is still seen as a reference.
    const markup = text.replace(SCRIPT_BLOCK, (whole, body) => whole.replace(body, ''));
    for (const match of markup.matchAll(MARKUP_REF)) {
      const ref = normalizeRef(match[1]);
      if (ref) refs.add(ref);
    }
    for (const block of text.matchAll(SCRIPT_BLOCK)) {
      for (const match of block[1].matchAll(STRING_LITERAL)) {
        const ref = normalizeRef(match[1] ?? match[2] ?? '');
        if (ref) refs.add(ref);
      }
    }
  } else {
    for (const match of text.matchAll(STRING_LITERAL)) {
      const ref = normalizeRef(match[1] ?? match[2] ?? '');
      if (ref) refs.add(ref);
    }
  }
  return refs;
}

// Breadth-first walk of the served asset graph, starting at the two pages.
const referenced = new Set();
const queue = ['index.html', 'tester.html'];
while (queue.length) {
  const path = queue.shift();
  if (referenced.has(path)) continue;
  referenced.add(path);
  const text = await readFile(join(ROOT, path), 'utf8');
  for (const ref of refsOf(path, text)) {
    if (isServedPath(ref) && (await exists(ref)) && !referenced.has(ref)) queue.push(ref);
  }
}

const uncovered = [...referenced].filter((ref) => !FILES.includes(ref)).sort();
if (uncovered.length) {
  console.error(
    '❌ files the site loads are missing from the mirror file list:\n' +
      uncovered.map((ref) => `     - ${ref}`).join('\n') +
      '\n   Add each one to FILES in scripts/check-mirrors.mjs and to the Space sync list in README.md.',
  );
  process.exit(1);
}
log(`asset graph: ${referenced.size} local file(s) loaded by the site, all covered by FILES`);

// Files the platform serves itself, overriding the copy in the repo.
// `expect` is what the platform is known to serve; anything else means the
// behaviour changed and the entry needs re-checking by hand.
const KNOWN_SHADOW = {
  'HF Space': {
    'robots.txt': 'User-agent: *\nAllow: /\n',
  },
};

// The HF static runtime injects this into <head> of every served HTML file.
const HF_INJECT = /<script>window\.huggingface=\{[^<]*?\};?<\/script>/g;

function normalizeHtml(text, mirrorName) {
  if (mirrorName !== 'HF Space') return text;
  // The injected script sits directly after <head>; removing it restores the
  // exact bytes of the committed file.
  return text.replace(HF_INJECT, '');
}

async function fetchFile(base, path) {
  const url = `${base.replace(/\/$/, '')}/${path}`;
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
    headers: { 'user-agent': 'gradio-pipeline-directory-mirror-check/1.0' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return { url, buf };
}

let failures = 0;
const results = [];

for (const mirror of MIRRORS) {
  log(`checking ${mirror.name} (${mirror.base})`);
  for (const path of FILES) {
    const localPath = join(ROOT, path);
    let localBuf;
    try {
      localBuf = await readFile(localPath);
    } catch {
      console.error(`  ❌ ${path}: missing from the working tree — is the file list stale?`);
      failures++;
      results.push({ mirror: mirror.name, path, status: 'missing-local' });
      continue;
    }

    let served;
    try {
      served = await fetchFile(mirror.base, path);
    } catch (err) {
      console.error(`  ❌ ${path}: ${mirror.name} unreachable (${err.message})`);
      failures++;
      results.push({ mirror: mirror.name, path, status: 'unreachable' });
      continue;
    }

    const isText = /\.(html|txt|xml|css|js|json)$/.test(path);
    let same = false;
    if (isText) {
      const a = normalizeHtml(localBuf.toString('utf8'), mirror.name);
      const b = normalizeHtml(served.buf.toString('utf8'), mirror.name);
      same = a === b;
    } else {
      same = sha256(localBuf) === sha256(served.buf);
    }

    if (same) {
      console.log(`  ✅ ${path}`);
      results.push({ mirror: mirror.name, path, status: 'same' });
      continue;
    }

    // Not equal — is it a file the platform serves itself?
    const shadow = KNOWN_SHADOW[mirror.name]?.[path];
    if (shadow !== undefined) {
      const servedText = served.buf.toString('utf8');
      if (servedText === shadow) {
        console.log(`  ℹ️  ${path}: served by the platform, not the repo (known shadow — repo copy is committed and in sync)`);
        results.push({ mirror: mirror.name, path, status: 'shadow' });
        continue;
      }
      console.error(
        `  ❌ ${path}: ${mirror.name} serves something neither the repo nor the known platform default matches.\n` +
          `     served (${served.buf.length} bytes): ${JSON.stringify(servedText.slice(0, 120))}`,
      );
      failures++;
      results.push({ mirror: mirror.name, path, status: 'shadow-changed' });
      continue;
    }

    console.error(
      `  ❌ ${path}: ${mirror.name} does not match the working tree ` +
        `(local ${localBuf.length} bytes, served ${served.buf.length} bytes) — mirror is stale or diverged`,
    );
    failures++;
    results.push({ mirror: mirror.name, path, status: 'differs' });
  }
}

const counts = results.reduce((acc, r) => {
  acc[r.status] = (acc[r.status] || 0) + 1;
  return acc;
}, {});

log('');
log(
  `summary: ${counts.same || 0} identical, ${counts.shadow || 0} platform-shadowed, ` +
    `${(counts.differs || 0) + (counts.unreachable || 0) + (counts['missing-local'] || 0) + (counts['shadow-changed'] || 0)} failing`,
);

if (failures) {
  console.error(`\n❌ ${failures} mirror mismatch(es)`);
  process.exit(1);
}
console.log('\n✅ ALL MIRRORS IN SYNC');
process.exit(0);
