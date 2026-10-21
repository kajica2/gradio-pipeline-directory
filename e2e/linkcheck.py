#!/usr/bin/env python3
"""Link liveness audit for the Gradio Pipeline Directory.

Checks every outbound URL in data/*.json against the live web and reports
status codes. Distinguishes hard 404s from soft failures (403 bot walls,
429 rate limits, timeouts) so a blocked fetch is never mistaken for a dead
link -- and a real 404 is never waved through.

Hugging Face needs special handling. HF serves an *unauthenticated* web page
for public repos (200) but answers 401 for BOTH gated repos and repos that do
not exist, so a plain HTTP status check cannot tell "needs a licence" from
"was deleted". The listing API (`/api/datasets?search=owner/name`) is public
and returns an exact id match only when the repo exists, so it is used as the
oracle for every huggingface.co repo URL.

Usage:
    python3 e2e/linkcheck.py            # audit all data files
    python3 e2e/linkcheck.py --json     # machine-readable output
"""

import concurrent.futures as cf
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_FILES = ["data/hub.json", "data/featured.json", "data/categories.json"]

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

# Hosts that hard-block automated clients. A 403 from these is a bot-wall,
# not evidence the target is missing.
SOFT_BLOCK_HOSTS = {
    "www.pyannote.ai",
    "audiocraft.metademolab.com",
    "openai.com",
    "silero.ai",
    "zenodo.org",
}

# Placeholder fragments used in documentation strings, not real links.
PLACEHOLDER_MARKERS = ("OWNER/REPO", "YOUR_", "owner/repo", "<your", "example.com")

HF_RE = re.compile(
    r"^https?://huggingface\.co/(?:(datasets|models|spaces)/)?([^/?#]+/[^/?#]+)"
)

# Site paths on huggingface.co that are NOT repo ids.
HF_NON_REPO_PATHS = {
    "docs", "settings", "api", "chat", "collections", "papers", "blog",
    "learn", "pricing", "enterprise", "tasks", "discussions", "organizations",
    "explore", "login", "join", "new", "notifications", "search", "join",
    "front", "tokens", "settings",
}


def is_hf_repo_url(url):
    """True only for huggingface.co URLs that point at a model/dataset/space."""
    parsed = urllib.parse.urlparse(url)
    if parsed.netloc.lower() != "huggingface.co":
        return False
    segments = [s for s in parsed.path.split("/") if s]
    if not segments:
        return False
    if segments[0] in ("datasets", "models", "spaces"):
        return len(segments) >= 2
    # Bare owner/name form (models are usually linked without the prefix).
    if len(segments) == 2 and segments[0] not in HF_NON_REPO_PATHS:
        return True
    return False


def collect_urls():
    urls = set()

    def walk(node):
        if isinstance(node, dict):
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)
        elif isinstance(node, str):
            for m in re.findall(r"https?://[^\s\)\]\"'<>`]+", node):
                urls.add(m.rstrip(".,;"))

    for rel in DATA_FILES:
        path = os.path.join(ROOT, rel)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                walk(json.load(fh))
    return sorted(urls)


def is_placeholder(url):
    return any(marker in url for marker in PLACEHOLDER_MARKERS)


def hf_exists(url):
    """Resolve a huggingface.co repo URL via the public listing API.

    Returns (exists: bool|None, detail: str)."""
    m = HF_RE.match(url)
    if not m:
        return None, "not-a-repo-url"
    kind = m.group(1)
    repo_id = m.group(2).rstrip("/")

    kinds = [kind] if kind else ["models", "datasets", "spaces"]
    for k in kinds:
        api = f"https://huggingface.co/api/{k}"
        query = urllib.parse.urlencode({"search": repo_id, "limit": "50"})
        try:
            with urllib.request.urlopen(
                urllib.request.Request(f"{api}?{query}", headers={"User-Agent": UA}),
                timeout=20,
            ) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001
            return None, f"lookup-failed:{type(exc).__name__}"

        ids = [item.get("id") for item in data] if isinstance(data, list) else []
        if repo_id in ids:
            return True, f"{k}-listed"

        # Some repos are private/gated and never surface in search; fall back
        # to the owner listing before calling it missing.
        owner = repo_id.split("/")[0]
        try:
            with urllib.request.urlopen(
                urllib.request.Request(
                    f"{api}?{urllib.parse.urlencode({'author': owner, 'limit': '100'})}",
                    headers={"User-Agent": UA},
                ),
                timeout=20,
            ) as resp:
                owner_data = json.loads(resp.read().decode("utf-8"))
        except Exception:  # noqa: BLE001
            owner_data = []
        owner_ids = [
            item.get("id") for item in owner_data
        ] if isinstance(owner_data, list) else []
        if repo_id in owner_ids:
            return True, f"{k}-listed-by-owner"

    return False, "not-in-hub-index"


def check(url, timeout=25, retries=2):
    """Return (url, status, final_url, note). status is an int or None."""
    host = urllib.parse.urlparse(url).netloc.lower()
    last = None
    for attempt in range(retries + 1):
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": UA,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
            },
            method="GET",
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return url, resp.status, resp.geturl(), "ok"
        except urllib.error.HTTPError as exc:
            last = (url, exc.code, exc.geturl(), "http-error")
            if exc.code != 429:
                break
        except urllib.error.URLError as exc:
            last = (url, None, None, f"urlerror:{exc.reason}")
        except Exception as exc:  # noqa: BLE001
            last = (url, None, None, f"error:{type(exc).__name__}")
        if attempt < retries:
            time.sleep(1.5 * (attempt + 1))

    url, status, final, note = last
    if status == 429:
        note = "rate-limited"
    elif status in (401, 403) and host in SOFT_BLOCK_HOSTS:
        note = "bot-wall"
    return url, status, final, note


def audit_url(url):
    """Full check for one URL, using the HF listing API where needed.

    Decision order:
      1. placeholder strings are skipped
      2. a plain 200 means the target exists (HF serves a redirect for renamed
         repos, so this also covers renames)
      3. a 401 on a HF repo URL is ambiguous -- the listing API decides
         between "exists but gated" and "deleted"
      4. everything else is dead unless it is a known bot-wall
    """
    if is_placeholder(url):
        return url, None, None, "placeholder"

    url, status, final, note = check(url)

    if status == 200:
        return url, status, final, "ok"

    if status == 401 and is_hf_repo_url(url):
        exists, detail = hf_exists(url)
        if exists is True:
            return url, 200, url, f"hf-{detail}-gated"
        if exists is False:
            return url, 404, url, f"hf-{detail}"
        # lookup failed -> report as unverified rather than dead
        return url, status, final, "hf-lookup-failed"

    return url, status, final, note


def space_hosts():
    """Return the live Space hosts referenced by featured.json.

    A Space URL on huggingface.co is a front door; the app itself is served
    from <owner>-<name>.hf.space. A Space that is sleeping answers 503 and
    one that was removed answers 404, so the front-door URL can look fine
    while the demo is dead.
    """
    hosts = {}
    path = os.path.join(ROOT, "data", "featured.json")
    if not os.path.exists(path):
        return hosts
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    for tool in data.get("tools", []):
        url = tool.get("spaceUrl")
        if not url:
            continue
        m = re.match(
            r"^https?://huggingface\.co/spaces/([^/]+)/([^/?#]+)", url
        )
        if not m:
            continue
        owner, name = m.group(1), m.group(2)
        host = f"{owner}-{name}".lower() + ".hf.space"
        hosts[host] = tool.get("id") or url
    return hosts


def check_space_host(host):
    """Probe a Space's /config. Returns (status, note)."""
    url = f"https://{host}/config"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read()
            try:
                cfg = json.loads(raw.decode("utf-8"))
            except Exception:
                return resp.status, "live-unparsed"
            deps = cfg.get("dependencies") or []
            if not deps:
                return resp.status, "live-no-endpoints"
            return resp.status, f"live ({len(deps)} endpoint(s))"
    except urllib.error.HTTPError as exc:
        if exc.code == 503:
            return 503, "sleeping"
        if exc.code == 404:
            return 404, "missing"
        return exc.code, "http-error"
    except Exception as exc:  # noqa: BLE001
        return None, f"error:{type(exc).__name__}"


def main():
    as_json = "--json" in sys.argv
    urls = collect_urls()
    print(f"Checking {len(urls)} unique URLs...\n", file=sys.stderr)

    results = []
    with cf.ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(audit_url, u): u for u in urls}
        for fut in cf.as_completed(futures):
            results.append(fut.result())

    results.sort(key=lambda r: (r[1] is None, r[1] or 0, r[0]))

    dead, soft, ok, placeholders = [], [], [], []
    for url, status, final, note in results:
        if note == "placeholder":
            placeholders.append(url)
        elif status and status < 400:
            ok.append((url, status, final))
        elif note in ("bot-wall", "rate-limited"):
            soft.append((url, status, final, note))
        else:
            dead.append((url, status, final, note))

    print(f"OK            : {len(ok)}")
    print(f"SOFT (wall)   : {len(soft)}")
    print(f"DEAD          : {len(dead)}")
    print(f"PLACEHOLDER   : {len(placeholders)}")
    print()

    if dead:
        print("=== DEAD / SUSPECT ===")
        for url, status, final, note in dead:
            print(f"  [{status}] {note}")
            print(f"        {url}")
            if final and final != url:
                print(f"     -> {final}")
        print()

    if soft:
        print("=== SOFT (not verified by bot -- confirm in a browser) ===")
        for url, status, final, note in soft:
            print(f"  [{status}] {note}  {url}")
        print()

    if placeholders:
        print("=== PLACEHOLDERS (skipped) ===")
        for url in placeholders:
            print(f"  {url}")
        print()

    # --- Gradio Space health -------------------------------------------
    spaces = space_hosts()
    space_results = []
    with cf.ThreadPoolExecutor(max_workers=6) as pool:
        futures = {pool.submit(check_space_host, h): h for h in spaces}
        for fut in cf.as_completed(futures):
            host = futures[fut]
            status, note = fut.result()
            space_results.append((host, status, note))
    space_results.sort()
    dead_spaces = [s for s in space_results if s[1] != 200]
    print(f"SPACES: {len(space_results) - len(dead_spaces)} live / {len(space_results)}")
    for host, status, note in space_results:
        mark = "OK " if status == 200 else "!! "
        print(f"  {mark}[{status}] {note:<16} {host}  ({spaces[host]})")
    print()

    if as_json:
        print(json.dumps(
            {
                "checked": len(urls),
                "ok": len(ok),
                "soft": [{"url": u, "status": s, "note": n} for u, s, f, n in soft],
                "dead": [{"url": u, "status": s, "note": n} for u, s, f, n in dead],
                "placeholders": placeholders,
                "spaces": [
                    {"host": h, "status": s, "note": n, "tool": spaces[h]}
                    for h, s, n in space_results
                ],
                "all": [{"url": u, "status": s, "final": f, "note": n} for u, s, f, n in results],
            },
            indent=2,
        ))
    else:
        print("=== ALL URLS (status) ===")
        for url, status, final, note in results:
            print(f"  {str(status or 'ERR'):>4}  {note:<22} {url}")

    return 1 if (dead or dead_spaces) else 0


if __name__ == "__main__":
    sys.exit(main())
