"""
Gradio Pipeline Hub — Deployable Reference App
==============================================

This is the working Gradio app that backs the Hub directory. It is a
monophonic / polyphonic music transcription tool built on Spotify's
Basic Pitch. Deploy it to your own Hugging Face Space in one command:

    gradio deploy --token YOUR_HF_TOKEN --repo https://github.com/kajica2/gradio-pipeline-hub/tree/main/public/gradio-app

(or, equivalently, drop these three files into a new HF Space with the
Gradio SDK and the Space will pick them up automatically.)

What it does
------------
* Audio in (.wav, .mp3, .flac, .ogg, .m4a — anything ffmpeg handles)
* Output 1: A piano-roll PNG (matplotlib)
* Output 2: The transcribed MIDI file (downloadable)
* Output 3: A small JSON summary (notes, key, tempo, range)

Why this matters
----------------
The whole point of the Hub is "zero local setup." A user can:
  1. Open the Hub
  2. Pick this card
  3. Click Deploy → copy the command → run it once with their HF token
  4. Get a personal transcription Space in <2 minutes

No Python install. No virtualenv. No GPU (Basic Pitch runs on CPU).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import gradio as gr
import numpy as np
import librosa
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

# Basic Pitch (Spotify) — lightweight CNN+GRU transcriber
# Install via: pip install basic-pitch
try:
    from basic_pitch.inference import predict as bp_predict
    from basic_pitch import ICASSP_2022_MODEL_PATH
    BASIC_PITCH_AVAILABLE = True
except Exception as e:  # pragma: no cover
    BASIC_PITCH_AVAILABLE = False
    _BP_IMPORT_ERROR = e


SAMPLE_RATE = 22050  # basic-pitch internally runs at 22.05 kHz


def _safe_unlink(path: str | None) -> None:
    if not path:
        return
    try:
        os.unlink(path)
    except OSError:
        pass


def transcribe(audio_path: str, onset_thresh: float, frame_thresh: float, min_note_len_ms: int):
    """
    Run Basic Pitch on the uploaded audio. Returns:
      - piano roll PNG
      - MIDI file path (downloadable)
      - JSON summary string
    """
    if not audio_path:
        raise gr.Error("Please upload or record an audio file first.")
    if not BASIC_PITCH_AVAILABLE:
        raise gr.Error(
            "basic-pitch is not installed in this environment. "
            "Add it to requirements.txt and restart the Space. "
            f"Import error: {_BP_IMPORT_ERROR}"
        )

    onset = float(onset_thresh)
    frame = float(frame_thresh)
    min_len = int(min_note_len_ms)

    # Basic Pitch returns (model_output, midi_data, note_events)
    try:
        _model_out, midi_data, note_events = bp_predict(
            audio_path,
            onset_threshold=onset,
            frame_threshold=frame,
            minimum_note_length=min_len,
            minimum_frequency=0.0,
        )
    except Exception as e:
        raise gr.Error(f"Transcription failed: {e}")

    # Save MIDI
    midi_path = tempfile.mktemp(suffix=".mid")
    midi_data.write(midi_path)

    # Piano roll PNG
    roll = np.zeros((88, 128), dtype=np.float32)  # placeholder bounds
    # Build a piano roll from note_events (start, end, pitch, velocity, [pitch_bend])
    pitches = []
    starts = []
    ends = []
    if note_events:
        for ne in note_events:
            try:
                start_s, end_s, pitch, vel, _bend = ne
            except ValueError:
                start_s, end_s, pitch, vel = ne[:4]
            pitches.append(int(pitch))
            starts.append(float(start_s))
            ends.append(float(end_s))

        lo = max(21, min(pitches))
        hi = min(108, max(pitches))
        span = max(1, hi - lo + 1)
        # Render at ~50 px / second for legibility
        y_axis = list(range(lo, hi + 1))
        duration = max(ends) if ends else 0.0
        n_steps = max(1, int(duration * 50))
        roll = np.zeros((span, n_steps), dtype=np.float32)
        for s, e, p in zip(starts, ends, pitches):
            x0 = int(s * 50)
            x1 = max(x0 + 1, int(e * 50))
            yy = p - lo
            if 0 <= yy < span:
                roll[yy, x0:x1] = 1.0

        fig, ax = plt.subplots(figsize=(10, 4), dpi=100)
        ax.imshow(
            roll,
            aspect="auto",
            origin="lower",
            cmap="magma",
            extent=(0, duration, lo - 0.5, hi + 0.5),
        )
        ax.set_xlabel("Time (s)")
        ax.set_ylabel("MIDI pitch")
        ax.set_yticks([y for y in y_axis if y % 12 == 0])
        ax.set_yticklabels([_midi_to_name(y) for y in y_axis if y % 12 == 0])
        ax.set_title(f"Detected notes ({len(note_events)} events)")
        fig.tight_layout()
        roll_path = tempfile.mktemp(suffix=".png")
        fig.savefig(roll_path, dpi=100)
        plt.close(fig)
    else:
        # No notes found — empty figure so the UI still has something
        fig, ax = plt.subplots(figsize=(10, 4), dpi=100)
        ax.text(0.5, 0.5, "No notes detected", ha="center", va="center",
                transform=ax.transAxes, color="#9094a6")
        ax.set_axis_off()
        roll_path = tempfile.mktemp(suffix=".png")
        fig.savefig(roll_path, dpi=100)
        plt.close(fig)

    # JSON summary
    summary = _build_summary(note_events, audio_path)
    return roll_path, midi_path, json.dumps(summary, indent=2)


def _midi_to_name(m: int) -> str:
    NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return f"{NAMES[m % 12]}{(m // 12) - 1}"


def _build_summary(note_events, audio_path: str) -> dict:
    if not note_events:
        return {
            "file": Path(audio_path).name,
            "notes_detected": 0,
            "key": "—",
            "tempo": "—",
            "range": "—",
        }
    pitches, starts, ends = [], [], []
    for ne in note_events:
        try:
            s, e, p, _v, _b = ne
        except ValueError:
            s, e, p, _v = ne[:4]
        pitches.append(int(p))
        starts.append(float(s))
        ends.append(float(e))

    lo, hi = min(pitches), max(pitches)
    tempo = _estimate_tempo(starts)
    key_name = _estimate_key(pitches, starts, ends)
    return {
        "file": Path(audio_path).name,
        "notes_detected": len(note_events),
        "key": key_name,
        "tempo": tempo,
        "range": f"{_midi_to_name(lo)} – {_midi_to_name(hi)}",
        "low_pitch": lo,
        "high_pitch": hi,
        "duration_sec": round(max(ends), 3) if ends else 0.0,
    }


def _estimate_tempo(onsets: list[float]) -> str:
    if len(onsets) < 4:
        return "—"
    onsets = sorted(onsets)
    last = onsets[-1]
    if last < 1.0:
        return "—"
    SR_MS = 1000
    SIGMA = 35
    len_ms = int(last * SR_MS) + SIGMA * 6
    kernel = np.zeros(len_ms, dtype=np.float32)
    s2 = SIGMA * SIGMA
    for o in onsets:
        c = int(o * SR_MS)
        for d in range(-SIGMA * 3, SIGMA * 3 + 1):
            idx = c + d
            if 0 <= idx < len_ms:
                kernel[idx] = np.exp(-(d * d) / (2 * s2))
    best_bpm, best_score = 120, 0
    scores = {}
    for bpm in range(40, 241):
        beat = 60000 / bpm
        s = 0.0
        t = 0.0
        while t < len_ms:
            idx = int(t)
            if idx < len_ms:
                s += kernel[idx]
            t += beat
        scores[bpm] = s
        if s > best_score:
            best_score, best_bpm = s, bpm
    half = best_bpm / 2
    if half >= 40 and scores[int(half)] >= best_score * 0.7:
        best_bpm = int(half)
    return f"{best_bpm} BPM"


_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def _estimate_key(pitches, starts, ends) -> str:
    hist = [0.0] * 12
    for p, s, e in zip(pitches, starts, ends):
        hist[p % 12] += max(0.0, e - s)
    best = (-1, 0, "major")
    for root in range(12):
        maj = sum(hist[(i + root) % 12] * _MAJOR[i] for i in range(12))
        minr = sum(hist[(i + root) % 12] * _MINOR[i] for i in range(12))
        if maj > best[0]:
            best = (maj, root, "major")
        if minr > best[0]:
            best = (minr, root, "minor")
    NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
    return f"{NAMES[best[1]]} {best[2]}"


# ---------------- Gradio UI ----------------

with gr.Blocks(
    title="Music Transcription — Basic Pitch",
    theme=gr.themes.Soft(primary_hue="teal"),
) as demo:
    gr.Markdown(
        """
# 🎵 Music Transcription
Drop in a song (or just a chord progression) and get a piano roll,
MIDI file, and key/tempo analysis. Built on **Spotify Basic Pitch**.

> Deployed from the [Gradio Pipeline Hub](https://kajica2.github.io/gradio-pipeline-hub/).
> Zero local setup — your audio never leaves Hugging Face.
        """
    )

    with gr.Row():
        with gr.Column():
            audio = gr.Audio(
                label="Audio input",
                type="filepath",
                sources=["upload", "microphone"],
            )
            with gr.Accordion("Advanced", open=False):
                onset = gr.Slider(0.1, 0.9, value=0.5, step=0.05, label="Onset threshold")
                frame = gr.Slider(0.1, 0.9, value=0.3, step=0.05, label="Frame threshold")
                min_len = gr.Slider(20, 500, value=50, step=10, label="Minimum note length (ms)")
            run = gr.Button("Transcribe", variant="primary")
        with gr.Column():
            roll = gr.Image(label="Piano roll", type="filepath")
            midi = gr.File(label="MIDI (downloadable)")
            summary = gr.Code(label="Analysis summary", language="json")

    run.click(
        fn=transcribe,
        inputs=[audio, onset, frame, min_len],
        outputs=[roll, midi, summary],
    )

    gr.Markdown(
        """
### Tips
* **Polyphonic** audio (piano, guitar) works well. **Drums-only** tracks will give messy pitch output — that's expected.
* Use the **onset threshold** slider if you're getting too many false positives (raise it) or too few notes (lower it).
* The MIDI file is type 1, ready to import into your DAW (Logic, Ableton, Reaper, MuseScore).
        """
    )


if __name__ == "__main__":
    demo.queue(max_size=8).launch(server_name="0.0.0.0", server_port=7860)
