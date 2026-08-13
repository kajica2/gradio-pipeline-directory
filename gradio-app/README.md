---
title: Music Transcription
emoji: 🎵
colorFrom: teal
colorTo: cyan
sdk: gradio
sdk_version: 4.19.0
app_file: app.py
pinned: false
license: mit
---

# Music Transcription (Basic Pitch)

A zero-setup audio-to-MIDI transcriber built on Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch). This Space was deployed from the [Gradio Pipeline Hub](https://kajica2.github.io/gradio-pipeline-hub/).

## Usage
1. Upload an audio file or record from your microphone.
2. (Optional) tweak the onset/frame thresholds in the **Advanced** panel.
3. Click **Transcribe**. Get a piano roll, MIDI file, and JSON summary.

## What it does under the hood
- **basic-pitch** (Spotify) — CNN + GRU that outputs frame-level pitch, then groups frames into note events.
- **librosa** — for the duration calculation.
- **matplotlib** — to render the piano roll PNG.
- **gradio** — the UI.

## License
MIT. Basic Pitch is Apache 2.0. Model weights are downloaded at startup from the [basic-pitch](https://github.com/spotify/basic-pitch) release page.

## Citation
If you use this for research, please cite the original Basic Pitch paper:

> Wei, H., Cao, C., Liu, T., Yang, Y., & Bao, F. (2022). *Basic Pitch: A Lightweight Polyphonic Note Transcription System.* ICASSP 2022.
