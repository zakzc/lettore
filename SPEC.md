# Lettore — Project Specification

Status: **Draft v0.5** (spec only, no code yet) — ready to start M0.

## 1. Overview

**Lettore** is a desktop app (web UI in a native shell) that loads a PDF, extracts and cleans its text, and reads it aloud with a local neural TTS voice. Everything runs offline on the user's machine.

**Revision (2026-11-23):** originally scoped as a Python backend + generic frontend. Now packaged as a **Tauri 2 desktop app with a React + TypeScript frontend**, keeping the Python extraction/TTS engine as a bundled **sidecar** process. Feasibility confirmed; Electron remains a valid alternative (see §3).

## 2. Feasibility

**Verdict: feasible, low-to-medium risk.** Both Tauri and Electron can host the existing design unchanged.

- Tauri 2 explicitly supports embedding external binaries ("sidecars"), and names Python CLI/API servers bundled with PyInstaller as a common use case.
- Kokoro (Apache-2.0) also ships a JavaScript build (`kokoro-js`) that runs fully in the browser via WebGPU or WASM. So a **no-Python** variant is possible if the Python bundle proves too heavy (see Option B).
- Main risks are packaging, not functionality: bundle size, sidecar lifecycle, per-OS signing, and licences (see §9).

## 3. Shell choice: Tauri vs Electron

- **Tauri 2 (recommended)**
    - Small shell, uses the OS webview (WebView2 / WebKit). Frontend is plain React/TS; the sidecar can be launched from the JS API, so no Rust needed beyond config.
    - Caveat: webview differences across OSes. Fine for Option A (audio is produced by the sidecar). Risky for Option B (WebGPU availability varies by webview).
- **Electron (valid alternative)**
    - Bundled Chromium = identical behaviour everywhere, WebGPU predictable, spawning a sidecar is just `child_process` in the main process (closest to Node/Express habits).
    - Costs ~100+ MB baseline and higher RAM. Since the Python sidecar is already large, the size gap matters less than usual.
- **Rule of thumb:** Option A → Tauri. Option B (pure JS, in-browser TTS) → Electron, or Tauri if WebGPU/WASM fallback is acceptable.

## 4. Architecture

**Option A (recommended): Tauri shell + Python sidecar**

```
┌─ Tauri app ──────────────────────────────┐
│  React + TS UI (webview)                 │
│   ├─ PDF viewer (pdf.js)                 │
│   ├─ Player controls + state (Redux)     │
│   └─ Web Audio API playback              │
│          │  HTTP/WebSocket on 127.0.0.1  │
│  ┌───────▼────────────────────────────┐  │
│  │ Python sidecar (FastAPI)           │  │
│  │  ├─ Extractor  (PyMuPDF)           │  │
│  │  ├─ Cleaner / classifier           │  │
│  │  ├─ Chunker                        │  │
│  │  └─ TTS (Kokoro, Piper optional)   │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

**Option B (fallback): all-JS, no sidecar**

- pdf.js for text + font metadata, heuristics for heading/quote detection, `kokoro-js` in a Web Worker (WebGPU, WASM fallback), `tesseract.js` for OCR.
- Pros: one language, one runtime, no PyInstaller. Works even as a plain browser web app.
- Cons: weaker layout analysis than PyMuPDF; first-run model download; WebGPU variance.

Decision: build Option A first; keep the sidecar API narrow (§6) so Option B can replace it later without touching the UI.

## 5. Components

**5.1 Frontend (React + TS)**

- Load screen: single "Load PDF" button (native file dialog via Tauri), drag-and-drop optional.
- After parsing: PDF view + playback controls (play, pause, stop). Later: speed, voice, skip paragraph, click-to-start-here.
- State: Redux Toolkit slice for player (`status`, `queue`, `currentChunkId`, `voice`, `rate`) and one for document (`pages`, `blocks`, `parseStatus`).
- Playback: stream audio chunks from the sidecar and queue them in an `AudioContext`. Replaces the original `sounddevice`/`pygame` idea, since audio now plays in the UI layer.
- Highlight the currently spoken block on the PDF page (block-level in v1, word-level later).
- Reference UI: `Screenshot 2026-11-18 at 14.24.06.png` in the repo root.

**5.2 Sidecar: extraction (Python)**

- PyMuPDF page-by-page; use block/span data (font size, weight, position), not plain text.
- Classify blocks: `heading` (level by relative font size/bold), `body`, `quote` (indentation, italics, quote marks), `footnote`, `header/footer/page-number` (repeated across pages, position at page margins → dropped).
- Clean: join broken line wraps, de-hyphenate, normalise whitespace, fix reading order for multi-column pages.
- Scanned PDFs: detect pages with no text layer → optional OCR (Tesseract), v2.
- Output: structured JSON (below), not a flat string.

**5.3 Sidecar: chunking + TTS**

- Chunk by sentence/paragraph (~1–3 sentences), never the whole document at once.
- Pipeline: synthesise chunk N+1 while chunk N plays (prefetch 2–3 chunks).
- Default engine **Kokoro** (best quality, Apache-2.0). **Piper** as an optional low-end-CPU engine behind the same interface.
- Headings can be read with a short pause; quotes optionally with a different voice (v2).

## 6. Sidecar API (local only)

Bound to `127.0.0.1` on a random free port, with a per-launch token passed by the shell.

- `POST /parse` `{ path }` → `{ docId, pages: [{ n, blocks: [{ id, type, text, bbox }] }], toc }`
- `GET /voices` → available voices/engines
- `WS /speak` `{ docId, fromBlockId, voice, rate }` → stream of `{ chunkId, blockId, audio (PCM/WAV), durationMs }`
- `POST /stop` → cancel the current synthesis
- `GET /health` → readiness (model loaded?)

Frontend only knows this contract, which is what makes Option B swappable.

## 7. Packaging and lifecycle

- Build the sidecar with PyInstaller; Tauri bundles it via `bundle.externalBin`. Binary names need a target-triple suffix (e.g. `-x86_64-unknown-linux-gnu`), one per platform shipped.
- Shell starts the sidecar on launch, waits for `/health`, and kills it on exit.
- **Known pitfall:** PyInstaller `--onefile` spawns the real Python process as a child, which can be orphaned when the app quits and keep holding the port. Prefer **onedir** mode, or kill the whole process tree on exit.
- **Known pitfall (Windows):** NSIS may not replace a PyInstaller sidecar on a same-version reinstall because the binary lacks a Windows version resource. Bump the version on every build.
- Model weights: download on first run into the app data dir (keeps the installer smaller), with a progress screen; option to bundle for fully offline installs.
- Size reality check: Python + ML runtime is the big item. Evaluate an ONNX-based Kokoro runtime rather than the PyTorch one to cut installer size (to be validated in the spike).

## 8. Milestones

- **M0 Spike (1–2 days):** Tauri + React hello-world launching a trivial Python sidecar, `/health` round trip, clean shutdown.
- **M1 Extraction:** PyMuPDF structured output + heading/body/quote classification, tested on 5–10 varied PDFs. Output JSON viewable in the UI.
- **M2 TTS:** Kokoro chunked streaming, Web Audio playback, play/pause/stop.
- **M3 UI polish:** load button, PDF view, block highlight, playback controls per screenshot.
- **M4 Packaging:** installers for the target OS, first-run model download, signing.
- **M5 v2:** OCR, Piper engine, word-level highlight, voice per block type, export to audio files.

## 9. Risks and licences

- **PyMuPDF is AGPL-3.0.** Fine for personal use; distributing the app publicly means opening your source or buying a commercial licence. `pypdf` (BSD-3) avoids this but gives less layout/font info, which hurts heading detection.
- **Piper:** the maintained repo (OHF-Voice/piper1-gpl) is GPL-3.0 (the old MIT repo is archived), so shipping it carries copyleft obligations. Another reason to default to Kokoro (Apache-2.0).
- **Bundle size / cold start:** model load can take seconds; show a loading state, keep the model warm.
- **Cross-platform audio/webview quirks:** test on every target OS early (milestone 1 and 3).
- **Heading detection accuracy** varies by PDF; keep the classifier heuristic-based and inspectable, with a debug view of block types.

## 10. Decisions (resolved questions)

1. Target OS: **macOS only** for now. Cross-platform signing/packaging pitfalls in §7 are deferred.
2. Distribution: **personal use**; the source is public (2026-11-23) under **AGPL-3.0**, matching PyMuPDF. Piper's GPL is not a blocker.
3. Platform: **desktop only**, no browser/web version. Option A stays; Option B is not pursued.
4. Highlighting: **block-level** in v1; word-level is v2.
5. README.md and progress.md follow this spec (updated 2026-11-23).

## 11. Stack mapping (from what you already know)

- Python sidecar (FastAPI) ≈ a local Express server the UI calls over `fetch`/WebSocket.
- PyInstaller ≈ bundling a Node app into a single executable (`pkg`/`esbuild` + runtime).
- PyMuPDF ≈ pdf.js on the server side, but with much richer layout/font data.
- Tauri ≈ Electron, but with the OS webview and a Rust core instead of Chromium + Node.
- Player state in Redux ≈ any async queue slice you'd write for a media player; the audio chunks are just like streamed fetch responses.