#!/usr/bin/env python3
"""Regression test for the Hugging Face link oracle in linkcheck.py.

Hugging Face serves an unauthenticated web page for public repos (200) but
answers 401 for BOTH gated repos and repos that do not exist. A plain status
check therefore cannot tell "needs a licence" from "was deleted" -- and a
previous revision of this site shipped four links in exactly that blind spot
(`musicnet/musicnet`, `mteb/mteb`, `stabilityai/stable-audio-open-1M`,
`kakaobrain/karlo-v1-alpha` were all 404, but a naive check saw them as
"gated" and let them through).

These cases pin the behaviour of the listing-API oracle.

Run:  python3 e2e/linkcheck.test.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import linkcheck as lc  # noqa: E402

# (url, expected: 'ok' | 'dead')
CASES = [
    # --- the four links that were silently broken -------------------------
    ("https://huggingface.co/datasets/musicnet/musicnet", "dead"),
    ("https://huggingface.co/datasets/mteb/mteb", "dead"),
    ("https://huggingface.co/datasets/stabilityai/stable-audio-open-1M", "dead"),
    ("https://huggingface.co/datasets/kakaobrain/karlo-v1-alpha", "dead"),
    # --- replacements that are live ---------------------------------------
    ("https://huggingface.co/datasets/mteb/results", "ok"),
    ("https://huggingface.co/datasets/malerlab/musicnet-unidac4-ytsv", "ok"),
    ("https://huggingface.co/datasets/Gaie/t2a_stable_audio_open", "ok"),
    ("https://huggingface.co/datasets/epr-labs/music-net", "ok"),
    ("https://huggingface.co/datasets/openslr/librispeech_asr", "ok"),
    ("https://huggingface.co/stabilityai/stable-audio-open-1.0", "ok"),
    ("https://huggingface.co/kakaobrain/karlo-v1-alpha", "ok"),
    # --- site paths that must NOT be parsed as repo ids --------------------
    ("https://huggingface.co/settings/tokens", "ok"),
    ("https://huggingface.co/docs/transformers/index", "ok"),
    ("https://huggingface.co/docs/diffusers/index", "ok"),
    ("https://huggingface.co/docs/hub/spaces", "ok"),
]


def main():
    failures = 0
    width = max(len(u) for u, _ in CASES)
    for url, expected in CASES:
        _, status, _, note = lc.audit_url(url)
        got = "dead" if status == 404 else ("ok" if status == 200 else "unknown")
        mark = "PASS" if got == expected else "FAIL"
        if mark == "FAIL":
            failures += 1
        print(f"  [{mark}] got={got:<7} want={expected:<7} {url.ljust(width)}  {note}")

    print()
    if failures:
        print(f"❌ {failures}/{len(CASES)} FAILED")
        return 1
    print(f"✅ ALL {len(CASES)} CASES PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
