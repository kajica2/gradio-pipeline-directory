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
├── e2e/                    ← Puppeteer test suite
│   ├── directory.mjs       ← 30+ assertions: cards, modal, versions, theme
│   └── artifacts/          ← Screenshots from the last test run
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

Every tool modal shows:

```bash
gradio deploy --token YOUR_HF_TOKEN --repo https://github.com/OWNER/REPO
```

What this does:
1. Clones the repo.
2. Detects the Gradio app (looks for `app.py` by default, or whatever you pass via `--app-file`).
3. Creates a new Hugging Face Space under your account.
4. Pushes the code, sets up a Python SDK Space, installs requirements, and boots the app.

**Get a token:** <https://huggingface.co/settings/tokens> (needs **Write** access).

**Install the CLI:** `pip install gradio` (the deploy command is bundled with the Gradio library).

**If the app needs a custom file path:**

```bash
gradio deploy --token YOUR_HF_TOKEN \
  --repo https://github.com/Stability-AI/generative-models \
  --app-file demo/code/scripts/demo_svd.py
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

The tester page lets you connect to **any** deployed HF Space via the official `@gradio/client` (loaded from esm.sh). It:
1. Connects and reads the Gradio config.
2. Lists every API endpoint (`api_name`) with input counts and types.
3. Generates a form for the selected endpoint.
4. Fires a real request and shows the response.

Try it with `openai/whisper`, `suno/bark`, or any of the quick-pick chips.

## E2E tests (`e2e/directory.mjs`)

The repo ships a Puppeteer test suite that runs against a local server. It verifies, in order:

1. 12 directory cards render (matches `featured.json` count)
2. 11 category pills render
3. First card modal opens with `gradio deploy --token ... --repo ...` deploy command
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

---

## License

MIT. Tools listed in `featured.json` retain their own licenses — check each repo's `LICENSE` file before commercial use. Several tools in the seed list (Coqui XTTS, Stable Video Diffusion) have non-commercial clauses; the `license` field in each entry calls this out.

---

## Credits

- UI / layout inspired by [mcp.so/agents](https://mcp.so/agents).
- Theme / CSS variables built on top of the [music-transcription-monitor](https://kajica2.github.io/music-transcription-monitor/) design system.
- Deploy integration powered by [Gradio](https://gradio.app) and [Hugging Face Spaces](https://huggingface.co/spaces).
