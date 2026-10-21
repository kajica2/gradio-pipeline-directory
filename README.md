# Gradio Pipeline Directory

A modern, mcp.so-style web directory for discovering open-source **Gradio pipelines** that handle audio / video / multimodal tasks — and instantly deploying any of them to **Hugging Face Spaces** with a single command. Zero local setup. No Python. No GPU configuration.

> The site is **static** (vanilla HTML/CSS/JS) so it deploys for free on GitHub Pages, Vercel, Netlify, or any static host.
>
> **v2.0** adds a 5-version Hub — every section is curated through 5 persona-lens versions (Builder, Musician, Researcher, Creative Coder, Director). Pick your lens, the cards re-curate instantly.

---

## What's in the box

```
gradio-pipeline-directory/
├── index.html              ← Main directory + Hub (5-version picker)
├── tester.html             ← Tester: connect to any deployed HF Space
├── data/
│   ├── featured.json       ← Hand-picked, verified Gradio repos (the seed)
│   ├── categories.json     ← Sidebar categories + sort options
│   └── hub.json            ← 12 sections × 5 persona-lens versions
├── shared/
│   ├── styles.css          ← Theme, layout, cards, modal, version picker
│   └── app.js              ← Filter / sort / modal / search / version logic
├── gradio-app/             ← A working Gradio app (audio → MIDI) for self-host
│   ├── app.py
│   └── requirements.txt
├── e2e/                    ← Puppeteer test suite + link audit
│   ├── browser.mjs         ← Launcher: local Chrome, or attach to a running one
│   ├── directory.mjs       ← Local suite: cards, modal, versions, theme
│   ├── live-verify.mjs     ← Live suite against the deployed URL
│   ├── deploy-flow.mjs     ← HF token + one-click deploy flow
│   ├── tester.mjs          ← Connects to a live Space and fires a request
│   ├── linkcheck.py        ← Outbound link audit (HTTP + HF hub index)
│   ├── linkcheck.test.py   ← Regression test for the HF link oracle
│   └── artifacts/          ← Screenshots from the last test run
├── .github/ISSUE_TEMPLATE/
│   └── submit-tool.md      ← Backs the "Submit a tool" CTA
└── README.md
```

---

## Run it locally

No build step. Just serve the directory.

```bash
cd gradio-pipeline-directory
python3 -m http.server 5173
# → http://localhost:5173
```

Or with Node:

```bash
npx serve . -p 5173
```

Then open `http://localhost:5173` (directory) and `http://localhost:5173/tester.html` (tester).

---

## Deploy it

### GitHub Pages (recommended for `kajica2.github.io`)

1. Push to a GitHub repo.
2. Repo → Settings → Pages → Source: `main` / root.
3. Your site is live at `https://<user>.github.io/<repo>/` (or `https://<user>.github.io/` if the repo is `<user>.github.io`).

### Vercel / Netlify

Drag-and-drop the folder into [vercel.com/new](https://vercel.com/new). Done.

### Custom domain

Point a CNAME to your hosting target and set the `url` field in the deploy provider.

---

## Customize

### Add / remove categories

Edit `data/categories.json`:

```json
{
  "categories": [
    { "id": "audio-transcription", "label": "Audio Transcription", "icon": "🎙️", "color": "#7dd3c0" },
    { "id": "text-to-speech",      "label": "Text-to-Speech",      "icon": "🗣️", "color": "#60a5fa" }
    // add more, remove freely — IDs must be unique
  ],
  "sortOptions": [
    { "id": "stars",    "label": "Most stars" },
    { "id": "updated",  "label": "Recently updated" },
    { "id": "name",     "label": "Name (A–Z)" },
    { "id": "category", "label": "Category" }
  ]
}
```

The directory automatically re-renders the sidebar.

### Add / edit Hub versions (v2.0)

The Hub has **12 sections × 5 persona-lens versions = 60 curated content blocks**. Edit `data/hub.json`. The top-level `versions` array defines the personas:

```json
{
  "versions": [
    { "id": "builder",   "label": "Builder",         "icon": "🔨", "tagline": "Ship mode",        "color": "#7dd3c0" },
    { "id": "musician",  "label": "Musician",        "icon": "🎺", "tagline": "Trumpet + jazz",   "color": "#60a5fa" },
    { "id": "researcher","label": "Researcher",      "icon": "📚", "tagline": "Papers + eval",    "color": "#c084fc" },
    { "id": "creative",  "label": "Creative Coder",  "icon": "🎨", "tagline": "Shaders + 3D",     "color": "#f472b6" },
    { "id": "director",  "label": "Director",        "icon": "🎬", "tagline": "Meta-curator",     "color": "#fb923c" }
  ],
  "defaultVersion": "director",
  "sections": [
    {
      "id": "today",
      "title": "Today's Focus",
      "icon": "🎯",
      "kind": "tasks",
      "versions": {
        "builder":    { "tagline": "Concrete ship targets",   "items": [ { "text": "...", "done": false, "tag": "ship" } ] },
        "musician":   { "tagline": "Practice + jazz",         "items": [ ... ] },
        "researcher": { "tagline": "Reading + eval",          "items": [ ... ] },
        "creative":   { "tagline": "Sketch + shader + render","items": [ ... ] },
        "director":   { "tagline": "Cross-discipline curator","items": [ ... ] }
      }
    }
    // ... 11 more sections, each with 5 versions
  ]
}
```

**Add a new version persona** = add an entry in `versions` AND a `versions.<id>` block in every section.
**Add a new section** = add an entry in `sections` with all 5 version blocks (or just the ones that apply — missing ones fall back to `director`).
**Change the default lens** = edit `defaultVersion`.

The active version is persisted to `localStorage` AND the URL (`?v=musician`). Reload / share-links keep the lens. An in-modal version switcher lets users re-lens the open section without closing it.

### Add a new tool to the directory

Edit `data/featured.json` and add a new entry under `tools`:

```json
{
  "id": "my-cool-tool",
  "owner": "your-org",
  "repo": "your-repo",
  "name": "My Cool Tool",
  "description": "One-paragraph description shown on the card and in the modal.",
  "category": "audio-transcription",      // must match an ID in categories.json
  "language": "Python",
  "topics": ["asr", "speech"],
  "gradioFile": "app.py",                  // path inside the repo (default: app.py)
  "gradioPath": "/",                       // Gradio path within the app
  "homepage": "https://example.com",
  "spaceUrl": "https://huggingface.co/spaces/owner/name",  // optional
  "license": "MIT",
  "minGpu": false,
  "notes": "Free-form notes shown in the modal."
}
```

**Validation checklist before you ship:**
- The GitHub repo returns 200 (`curl -I https://github.com/<owner>/<repo>`)
- The repo has an `app.py` (or whatever you specify in `gradioFile`) at the path you point to
- If you link a `spaceUrl`, the Space URL returns 200 (private/gated Spaces return 401 — that's fine, still a real Space)
- The category ID in `featured.json` matches an ID in `categories.json`

### "Submit a tool" button

The Submit button in the header opens a prefilled GitHub issue:

```
https://github.com/<your-org>/gradio-pipeline-directory/issues/new?template=submit-tool.md
```

Add `.github/ISSUE_TEMPLATE/submit-tool.md` to your repo so the form is pre-populated with the right fields.

---

## The deploy command

### Primary path — one click, in the browser (zero setup)

Each tool modal leads with **Deploy to my HF**. You paste your Hugging Face
token once in the header; the page then creates a new Space in your account and
uploads the repo's files straight to it via the HF API. No Python, no clone, no
GPU config, no local install. This is the path the site is built around.

### Terminal path — if you prefer the CLI

Every tool modal also shows:

```bash
git clone --depth 1 https://github.com/OWNER/REPO && cd REPO && HF_TOKEN=hf_xxxxxxxxxxxxxxxx gradio deploy
```

What this does:
1. Clones the repo into a shallow checkout.
2. `cd`s into it, because `gradio deploy` always deploys the **current working
   directory**.
3. Creates a new Hugging Face Space under your account, uploads the code, sets
   up a Python SDK Space, installs requirements, and boots the app. The Space
   name comes from the directory name, so you get `your-name/REPO`.

> **Why the token is an env var and not a flag.** The Gradio CLI's `deploy`
> command accepts only `--title`, `--app-file` and `--provider`. It has never
> accepted `--token` or `--repo`, and it has no remote-repo mode at all. The
> token is read from `HF_TOKEN`, which `huggingface_hub` treats as the highest
> priority token source, so `HF_TOKEN=... gradio deploy` authenticates the
> upload without any extra steps.

**Get a token:** <https://huggingface.co/settings/tokens> (needs **Write** access).

**Install the CLI:** `pip install gradio` (the deploy command is bundled with
the Gradio library). If you use [`uv`](https://docs.astral.sh/uv/), `uvx gradio
deploy` runs it without installing anything.

**If the app needs a custom file path:**

```bash
git clone --depth 1 https://github.com/Stability-AI/generative-models && cd generative-models && \
  HF_TOKEN=hf_xxxxxxxxxxxxxxxx gradio deploy --app-file demo/code/scripts/demo_svd.py
```

The modal shows this automatically when the tool's `gradioFile` is not `app.py`.

---

## Architecture notes

- **No build step.** Pure HTML + ES2020 JS. Tailwind-style utility classes are not used; everything is custom CSS using design tokens. This keeps the project portable and easy to fork.
- **JSON-driven.** Categories and tools live in JSON files. Add a tool = edit `featured.json`. Add a Hub version = edit `data/hub.json` (see the "Add / edit Hub versions" section above).
- **Live star enrichment.** On load, the directory hits the GitHub API (no auth, 60 req/hr) for the first 6 tools to fetch real star counts and last-pushed timestamps. Results are cached in `sessionStorage` so the second visit is instant. If a tool already has a non-zero `stars` value in `featured.json`, it won't be re-fetched.
- **URL state.** Every filter, search, sort, AND hub version is reflected in the query string, so any view is shareable and the browser back/forward works. The active Hub version is also persisted to `localStorage`.
- **5-version Hub.** Every section in `data/hub.json` defines 5 persona-lens variants. The picker is a pill row above the Hub grid; the modal also has its own in-modal switcher so users can re-lens without closing. Total content blocks: 12 sections × 5 versions = 60 curated blocks. Default lens is the `Director` (meta-curator) view.
- **No backend.** A serverless function would let you cache GitHub responses across users and proxy the (sometimes CORS-restricted) HF API. For v1, the direct client-side approach is simpler and works for ≤60 req/hr per visitor.

---

## Tester (`tester.html`)

The tester page lets you connect to **any** deployed HF Space via the official `@gradio/client` (loaded from esm.sh, with a jsDelivr fallback). It:
1. Connects and reads the Gradio config.
2. Lists every API endpoint (`api_name`) with input counts and types.
3. Generates a form for the selected endpoint.
4. Fires a real request and shows the response.

Try it with `suno/bark`, `coqui/xtts`, or any of the quick-pick chips.

**Optional Hugging Face token.** The tester has a token field (stored in
`localStorage`, sent only to `huggingface.co`). It is needed for private
Spaces and it lifts the anonymous **ZeroGPU** quota — many modern Gradio
Spaces run on ZeroGPU and refuse anonymous callers with
*"You have exceeded your ZeroGPU quota"*.

**Why the client version is pinned to a major.** The tester used to pin
`@gradio/client@0.20.1`. That release sends every request with
`credentials: "include"`, which forces a CORS preflight; Hugging Face Spaces
do not answer preflights with `Access-Control-Allow-Credentials`, so the
browser blocked the response with *"TypeError: Failed to fetch"*. The tester
therefore failed against every current (Gradio 6) Space. Client 2.x defaults
to `credentials: "same-origin"` and works.

**Gradio 6 changed the endpoint shape.** `dependency.inputs` used to be a list
of component objects; in Gradio 6 it is a list of component **ids**, with the
definitions in `config.components`. The tester resolves both, so the form
renders correctly against Gradio 4, 5 and 6 Spaces.

Verify it against a live Space:

```bash
node e2e/tester.mjs
# optional: authenticate to lift ZeroGPU quotas
HF_TOKEN=hf_xxx SPACE_ID=suno/bark node e2e/tester.mjs
```

## E2E tests (`e2e/directory.mjs`)

The repo ships a Puppeteer test suite that runs against a local server. It verifies, in order:

1. 12 directory cards render (matches `featured.json` count)
2. 11 category pills render
3. First card modal opens with the `git clone … && HF_TOKEN=… gradio deploy` deploy command, plus the in-browser one-click deploy form
4. Search filter narrows to 1 card for "whisper"
5. Category filter narrows to 3 cards for "Voice Cloning"
6. 12 Hub cards render
7. "Latest Papers" modal opens with ≥3 external links
8. "Checklist" modal opens with ≥5 checkboxes
9. **5 version pills render** (Builder, Musician, Researcher, Creative Coder, Director)
10. Clicking a version pill updates the active version + URL (`?v=musician`)
11. Re-opening a section after a lens change shows the new content + "Musician lens" badge
12. In-modal version switcher has 5 pills
13. Dark/light theme toggle works
14. `tester.html` loads with ≥1 quick-pick chip

```bash
# In one terminal:
cd gradio-pipeline-directory
python3 -m http.server 5179

# In another:
URL_BASE=http://localhost:5179 node e2e/directory.mjs
```

Test artifacts (screenshots) land in `e2e/artifacts/`.

### Against the live site

```bash
npm install                # once — pulls puppeteer-core (no Chromium download)
node e2e/live-verify.mjs   # hits the deployed URL
node e2e/deploy-flow.mjs   # HF token + one-click deploy flow
```

The launcher (`e2e/browser.mjs`) prefers the system Chrome and falls back to
attaching to an already-running Chrome over CDP, so it works in sandboxes that
block Chrome's `ProcessSingleton` lock. Point it at a specific browser with
`CDP_PORT=<port>` or `CHROME_PATH=/path/to/chrome`.

### Link audit

Every outbound link in `data/*.json` is checked on demand:

```bash
python3 e2e/linkcheck.py       # audit, exits non-zero on a dead link
python3 e2e/linkcheck.test.py  # regression test for the HF link oracle
```

It also probes the **Gradio Spaces** the directory links to. A Space URL on
`huggingface.co` is only a front door — the app itself is served from
`<owner>-<name>.hf.space`, and a sleeping Space answers `503` while a removed
one answers `404`, so the front-door link can look perfectly healthy while the
demo is dead. The checker hits `/config` on the real host and reports the
endpoint count. Two of the four demo Spaces were dead when this check was
added (`akhaliq/demucs` and `coqui/xtts` both 503); they now point at live
replacements.

Hugging Face needs special care: HF serves an unauthenticated page for public
repos (200) but answers **401 for both gated repos and repos that do not
exist**, so a plain status check cannot tell "needs a licence" from "was
deleted". The checker therefore resolves every `huggingface.co` repo URL
against the public listing API, which returns an exact id match only when the
repo really exists. This is what catches a removed dataset — four such links
(`musicnet/musicnet`, `mteb/mteb`, `stabilityai/stable-audio-open-1M`,
`kakaobrain/karlo-v1-alpha`) were shipping as 404s behind a "gated" label.

---

## License

MIT. Tools listed in `featured.json` retain their own licenses — check each repo's `LICENSE` file before commercial use. Several tools in the seed list (Coqui XTTS, Stable Video Diffusion) have non-commercial clauses; the `license` field in each entry calls this out.

---

## Credits

- UI / layout inspired by [mcp.so/agents](https://mcp.so/agents).
- Theme / CSS variables built on top of the [music-transcription-monitor](https://kajica2.github.io/music-transcription-monitor/) design system.
- Deploy integration powered by [Gradio](https://gradio.app) and [Hugging Face Spaces](https://huggingface.co/spaces).
