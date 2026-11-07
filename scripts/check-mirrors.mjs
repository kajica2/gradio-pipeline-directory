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
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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
  'data/hub.json',
  'data/featured.json',
  'data/categories.json',
  'assets/img/og.png',
];

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

const log = (...a) => console.log('[mirrors]', ...a);
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

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
