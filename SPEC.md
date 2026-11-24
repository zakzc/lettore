# Lettore — Project Specification

Status: **v0.6**: implemented through M3.6 and being refined (M3.7). See [progress.md](progress.md) for what is done and what needs your verification.

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
- After parsing: PDF view + playback controls (play, pause, stop). Speed and voice (M2). Navigation (M3): double-click-to-start-here, a page minimap (click/drag to jump), skip paragraph forward/back, and per-block-type skip toggles (e.g. skip quotes/footnotes) so intros and comments can be bypassed. Language selector (M3.6): pick a language, then a voice of that language; Kokoro derives the TTS language from the voice id prefix.
- State: Redux Toolkit slice for player (`status`, `queue`, `currentChunkId`, `voice`, `rate`) and one for document (`pages`, `blocks`, `parseStatus`).
- Playback: stream audio chunks from the sidecar and queue them in an `AudioContext`. Replaces the original `sounddevice`/`pygame` idea, since audio now plays in the UI layer.
- Highlight the currently spoken block on the PDF page (block-level in v1, word-level later), and underline (blue) the exact sentence being read. Sentences are located on the page by the sidecar (`POST /geometry`), so no word timings from the TTS engine are needed.
- Reference UI: `Screenshot 2026-11-18 at 14.24.06.png` in the repo root.

**5.2 Sidecar: extraction (Python)**

- PyMuPDF page-by-page; use block/span data (font size, weight, position), not plain text.
- Classify blocks: `heading` (level by relative font size/bold), `body`, `quote` (indentation, italics, quote marks), `footnote`, `header/footer/page-number` (repeated across pages, position at page margins → dropped).
- Clean: join broken line wraps, de-hyphenate, normalise whitespace (ligatures, soft hyphens, symbol-font bullets), fix reading order for multi-column pages.
- Continuation: a body block that stops mid-sentence (no terminal punctuation) and is followed by a body block starting in lower case is spoken as one flow with it (column and page breaks, with skipped footnotes in between). Done at chunking time so the block list and highlight stay per block.
- Scanned PDFs: detect pages with no text layer → optional OCR (Tesseract), M6.
- Output: structured JSON (below), not a flat string.

**5.3 Sidecar: chunking + TTS**

- Chunk by sentence (one sentence per chunk, abbreviations such as "Dr." and initials do not end one), never the whole document at once. Each chunk carries `spans` (block id + character range) so the UI can underline exactly that sentence, including one that runs across a column or page break.
- Pipeline: synthesise chunk N+1 while chunk N plays (prefetch up to 4 sentences).
- Default engine **Kokoro** (best quality, Apache-2.0). **Piper** as an optional low-end-CPU engine behind the same interface.
- Pauses come from punctuation only: Kokoro adds 0.25 s after sentence ends and 0.1 s after clauses; a chunk that ends a sentence is padded to match, so chunk boundaries sound like the pauses inside a chunk. No extra silence at line, block or page breaks. Headings get no special pause yet.
- Kokoro has no emotion or emphasis control (plain text in, no SSML). Delivery changes only via voice, speed and pauses; real emotion control would need another engine behind the same interface.
- Quotes optionally with a different voice (v2).

## 6. Sidecar API (local only)

Bound to `127.0.0.1` on a random free port, with a per-launch token passed by the shell.

- `POST /parse` `{ path }` → `{ docId, pages: [{ n, blocks: [{ id, type, text, bbox }] }], toc }`
- `GET /voices` → `{ engine, voices: [{ id, name, lang, language, gender }] }`; the UI groups by language and shows `name` only
- `WS /speak?token=…` (browsers cannot set WebSocket headers) `{ docId, fromBlockId, voice, rate, skipTypes }` → stream of `{ chunkId, blockId, spans: [{ blockId, start, end }], sampleRate, durationMs, audio }` (base64 16-bit mono PCM), then `{ done: true }` or `{ error }`. The client sends `{ ack: chunkId }` when a chunk finishes playing; the server stays at most 4 chunks ahead (backpressure), so pause simply stalls the stream. `blockId` is the block where the chunk starts.
- `POST /stop` → cancel the current synthesis (a new `/speak` also cancels the previous one)
- `POST /geometry` `{ docId, blockId, start, end }` → `{ rects: [[x0, y0, x1, y1]] }`: page rectangles (PDF points) covering `block.text[start:end]`, one per text line, empty when it cannot be located (the UI then shows only the block highlight)
- `GET /doc/{docId}/file` → the original PDF, for the pdf.js view
- `GET /health` → `{ status, modelLoaded, modelError }`

HTTP endpoints use an `X-Token` header. `POST /parse` pages also carry `width` and `height` (PDF points); `bbox` is in the same space, top-left origin. Errors: 404 file not found, 422 unreadable/password-protected/scanned PDF (OCR is M6).

Frontend only knows this contract, which is what makes Option B swappable.

## 7. Packaging and lifecycle

- Build the sidecar with PyInstaller; Tauri bundles it via `bundle.externalBin`. Binary names need a target-triple suffix (e.g. `-x86_64-unknown-linux-gnu`), one per platform shipped.
- Shell starts the sidecar on launch, waits for `/health`, and kills it on exit.
- **Known pitfall:** PyInstaller `--onefile` spawns the real Python process as a child, which can be orphaned when the app quits and keep holding the port. **Current choice: onefile** (`externalBin` takes a single file; onedir needs resource bundling, deferred to M4) **plus an orphan guard**: the sidecar exits when its stdin closes, which happens on quit or crash. Revisit onedir in M4 if start-up time or the guard proves unreliable.
- **Known pitfall (Windows):** NSIS may not replace a PyInstaller sidecar on a same-version reinstall because the binary lacks a Windows version resource. Bump the version on every build.
- Model weights: download on first run into the app data dir (keeps the installer smaller), with a progress screen; option to bundle for fully offline installs.
- Size reality check: Python + ML runtime is the big item. Evaluate an ONNX-based Kokoro runtime rather than the PyTorch one to cut installer size (to be validated in the spike).

## 8. Milestones

- **M0 Spike (1–2 days):** Tauri + React hello-world launching a trivial Python sidecar, `/health` round trip, clean shutdown.
- **M1 Extraction:** PyMuPDF structured output + heading/body/quote classification, tested on 5–10 varied PDFs. Output JSON viewable in the UI.
- **M2 TTS:** Kokoro chunked streaming, Web Audio playback, play/pause/stop.
- **M3 UI polish:** load button, PDF view, block highlight, click-to-start-here, skip paragraph, per-type skip toggles, playback controls per screenshot.
- **M3.5 UI improvements:** first batch built (design pass with dark mode, settings panel, outline panel, resume and persisted settings). Deferred: empty-state/recent files, keyboard shortcuts, zoom, reading mode, loading/error states, accessibility pass.
- **M3.6 Language and voice selector:** voices grouped per language, shown by name without the id prefix (e.g. "Alex", not `pm_alex`).
- **M3.7 Natural speech flow:** no pauses at line/block/page breaks, punctuation-only pauses, consistent pause at chunk ends.
- **M3.8 Sentence underline:** blue underline on the exact sentence being read, on top of the block highlight.
- **M4 Packaging:** installers for the target OS, first-run model download, signing.
- **M4.5 Main-body detection:** tell the main text apart from side notes, side summaries and other boxes, mark them as a separate block type, and let the reader skip or keep them. Best effort: start with a feasibility spike on real PDFs, since layouts vary a lot (see §9).
- **M5 Extraction and voice optimisation:** measure and improve extraction accuracy and speed (large books, caching, list and quote handling) and voice latency, quality and tuning (faster first chunk, model/precision comparison, pause controls).
- **M6 v2:** OCR, Piper engine, word-level highlight, voice per block type, export to audio files.

## 9. Risks and licences

- **PyMuPDF is AGPL-3.0.** Fine for personal use; distributing the app publicly means opening your source or buying a commercial licence. `pypdf` (BSD-3) avoids this but gives less layout/font info, which hurts heading detection.
- **Piper:** the maintained repo (OHF-Voice/piper1-gpl) is GPL-3.0 (the old MIT repo is archived), so shipping it carries copyleft obligations. Another reason to default to Kokoro (Apache-2.0).
- **Bundle size / cold start:** model load can take seconds; show a loading state, keep the model warm.
- **Cross-platform audio/webview quirks:** test on every target OS early (milestone 1 and 3).
- **Main body vs side material (M4.5):** sidebars, margin notes and summary boxes have no marker in the PDF. Signals are only geometric (position outside the main text column, narrower width), typographic (smaller or different font, colour) and graphical (a filled or ruled box behind the text, via PyMuPDF drawings). Expect misses and false positives, so it stays heuristic, inspectable in the block-type overlay, and user-controllable (skip toggle).
- **Heading detection accuracy** varies by PDF; keep the classifier heuristic-based and inspectable, with a debug view of block types.

## 10. Decisions (resolved questions)

1. Target OS: **macOS only** for now. Cross-platform signing/packaging pitfalls in §7 are deferred.
2. Distribution: **personal use**; the source is public (2026-11-23) under **AGPL-3.0**, matching PyMuPDF. Piper's GPL is not a blocker.
3. Platform: **desktop only**, no browser/web version. Option A stays; Option B is not pursued.
4. Highlighting: **block-level** in v1; word-level is v2.
5. README.md and progress.md follow this spec (updated 2026-11-24).
6. Shell lifecycle: the Rust side spawns the sidecar (`tauri-plugin-shell`); PyInstaller onefile with a stdin-close orphan guard (see §7).
7. TTS: `kokoro-onnx` with the int8 model (no PyTorch); voices grouped by language, shown by name only.
8. UI: reading-first, calm, one accent colour, auto/light/dark; state in Redux (`document`, `player`, `ui`); settings and per-file reading position persisted in localStorage.
9. Navigation: double-click anywhere on a page to read from there, page minimap, outline panel, skip paragraph, skip-type toggles.

## 11. Stack mapping (from what you already know)

- Python sidecar (FastAPI) ≈ a local Express server the UI calls over `fetch`/WebSocket.
- PyInstaller ≈ bundling a Node app into a single executable (`pkg`/`esbuild` + runtime).
- PyMuPDF ≈ pdf.js on the server side, but with much richer layout/font data.
- Tauri ≈ Electron, but with the OS webview and a Rust core instead of Chromium + Node.
- Player state in Redux ≈ any async queue slice you'd write for a media player; the audio chunks are just like streamed fetch responses.
10. Sentence underline: one chunk per sentence plus a `/geometry` lookup (PyMuPDF text search inside the block), rather than TTS word timings or a separate word-position index.
