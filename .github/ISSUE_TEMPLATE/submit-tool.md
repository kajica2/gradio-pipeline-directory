---
name: Submit a tool
about: Suggest an open-source Gradio pipeline for the directory
title: "[Tool] owner/repo"
labels: ["tool submission"]
assignees: []
---

**Only open-source repos that run a real Gradio app qualify.** The bar is
"works, and can be deployed to a Hugging Face Space with one command."

<!--
Before you open this, please check the directory so we do not add a duplicate:
https://kajica2.github.io/gradio-pipeline-directory/
-->

### Repository

`https://github.com/owner/repo`

<!-- The public GitHub URL of the tool. -->

### Gradio entry file

`app.py`

<!--
Which file contains the Gradio app? Default is app.py.
If the app lives somewhere else (e.g. whisper/app.py), name it exactly.
-->

### One-line description

<!-- What does it do, in one sentence? -->

### Category

<!--
Pick one: transcription · text-to-speech · speech-to-text · audio-generation ·
video-generation · music-tools · computer-vision · agent-tools · other
-->

### Does it deploy cleanly to a free HF Space?

<!--
Yes / No / Not sure.

"Deploys cleanly" means: `gradio deploy` from a fresh clone with only a HF
write token produces a Space that boots on the free CPU tier. If the repo
needs a GPU, a custom system dependency, a model download over 5GB, or a
secret beyond the HF token, please say so — we will still list it, but with
a clear note so nobody wastes an hour on it.
-->

### Requirements beyond `requirements.txt`?

<!--
Anything the user must set up by hand: extra system packages, model weights
pulled from another host, a `preload.py`, an external API key.
If none, write "none".
-->

### Notes

<!--
Anything else worth knowing: known issues, license constraints, how large the
model download is, whether the demo Space still runs.
-->
