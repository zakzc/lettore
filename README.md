# Lettore

A local-first desktop app that loads a PDF, extracts and cleans its text, and reads it aloud with a local neural TTS voice. Everything runs offline on your Mac.

> **Status:** M0 spike (Tauri shell + Python sidecar `/health` round trip). See [progress.md](progress.md).
> **Source of truth:** [SPEC.md](SPEC.md). If this file disagrees with it, SPEC.md wins (and this file should then be fixed).

## Documents in this repo

| File | Purpose |
|---|---|
| [README.md](README.md) | Overview and conventions (this file) |
| [SPEC.md](SPEC.md) | Specification: architecture, sidecar API, milestones, risks |
| [progress.md](progress.md) | Implementation tracker |
| `Screenshot 2026-11-18 at 14.24.06.png` | Visual reference ("IQ Player") |

## Stack

| Layer | Choice |
|---|---|
| Shell | Tauri 2 (macOS, WebKit webview) |
| Frontend | React + TypeScript, Redux Toolkit, pdf.js, Web Audio API |
| Sidecar | Python, FastAPI, bundled with PyInstaller (onefile for the spike; onedir revisited in M4) |
| PDF extraction | PyMuPDF (AGPL-3.0; fine for personal use) |
| Speech | Kokoro (Apache-2.0); Piper optional in v2 |

## Architecture

```
Tauri app
 ├─ React + TS UI: pdf.js viewer, player controls (Redux), Web Audio playback
 │        │  HTTP / WebSocket on 127.0.0.1 (random port, per-launch token)
 └─ Python sidecar (FastAPI): extractor → cleaner/classifier → chunker → TTS
```

The sidecar API (SPEC §6) is the only contract the UI knows:

| Endpoint | Purpose |
|---|---|
| `POST /parse` | Extract a PDF into structured blocks + TOC |
| `GET /voices` | Available voices/engines |
| `WS /speak` | Stream synthesized chunks from a block |
| `POST /stop` | Cancel current synthesis |
| `GET /health` | Readiness (model loaded?) |

## Development

Requires macOS, Node, Rust (stable), and [uv](https://docs.astral.sh/uv/).

```sh
npm install
sidecar/build.sh      # builds src-tauri/binaries/lettore-sidecar-<target-triple> (Python 3.12 venv via uv)
npm run tauri dev     # starts the app; the shell spawns the sidecar
```

The shell passes `--port` and `--token` to the sidecar; the UI calls `/health` with an `X-Token` header. The sidecar exits when its stdin closes, so it cannot outlive the app.

## Conventions

- Treat sidecar responses as untrusted: check presence and validity, handle errors gracefully.
- Keep the sidecar API narrow so an all-JS backend could replace it later.
- Bind only to `127.0.0.1` and require the per-launch token.
- Kill the whole sidecar process tree on app exit.
- Update [progress.md](progress.md) in the same change that completes a step.

## Milestones

M0 Spike · M1 Extraction · M2 TTS · M3 UI polish · M4 Packaging · M5 v2 (OCR, Piper, word-level highlight, voice per block type, audio export). Details in SPEC §8.

## Non-goals (v1)

Windows/Linux, browser/web version, public distribution, OCR, word-level highlight, accounts or cloud sync.

## License

Personal use only; not distributed. PyMuPDF is AGPL-3.0, which is a non-issue under that constraint. Revisit if distribution is ever planned.
