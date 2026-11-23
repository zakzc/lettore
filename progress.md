# Lettore — Implementation Progress

Tracks implementation against [SPEC.md](SPEC.md) (milestones in §8) and [README.md](README.md).

**Legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[!]` blocked (add a note)

## Summary

| Milestone | Status | Done |
|---|---|---|
| Spec | Done (v0.5, decisions in §10) | — |
| M0 Spike | In progress | 4 / 5 |
| M1 Extraction | Not started | 0 / 7 |
| M2 TTS | Not started | 0 / 8 |
| M3 UI polish | Not started | 0 / 5 |
| M4 Packaging | Not started | 0 / 4 |
| M5 v2 (optional) | Not started | 0 / 5 |

**Current focus:** M0
**Last updated:** 2026-11-23

---

## M0 — Spike

- [x] Tauri 2 + React + TS scaffold
- [x] Trivial Python sidecar (FastAPI) with `GET /health`, bundled via `bundle.externalBin`
- [x] Shell starts sidecar on random port + token, waits for `/health`
- [x] UI shows `/health` result
- [~] Clean shutdown: no orphaned sidecar process or held port (PyInstaller onedir) — built onefile instead; sidecar exits on stdin EOF. Verify quit/kill by hand
- [ ] **Done when:** app launches, round-trips `/health`, and quitting leaves no sidecar running

## M1 — Extraction

- [ ] `POST /parse` returns `{ docId, pages: [{ n, blocks }], toc }`
- [ ] PyMuPDF block/span extraction (font size, weight, position)
- [ ] Block classification: heading, body, quote, footnote, header/footer/page-number (dropped)
- [ ] Cleaning: line joins, de-hyphenation, whitespace, multi-column reading order
- [ ] Block-type debug view in the UI
- [ ] Tested on 5–10 varied PDFs
- [ ] **Done when:** a real PDF's structured JSON is viewable in the UI

## M2 — TTS

- [ ] Chunker (1–3 sentences)
- [ ] TTS engine interface; Kokoro (ONNX runtime evaluated for size)
- [ ] `GET /voices`, `POST /stop`
- [ ] `WS /speak` streaming `{ chunkId, blockId, audio, durationMs }`
- [ ] Prefetch 2–3 chunks
- [ ] Web Audio playback queue in the UI
- [ ] Play / pause / stop
- [ ] **Done when:** a loaded PDF is read aloud from the start with working controls

## M3 — UI polish

- [ ] Load button (native file dialog)
- [ ] PDF view (pdf.js)
- [ ] Block-level highlight of the spoken block
- [ ] Playback controls per reference screenshot
- [ ] Redux slices: player (`status`, `queue`, `currentChunkId`, `voice`, `rate`) and document (`pages`, `blocks`, `parseStatus`)
- [ ] **Done when:** UI matches the reference and highlight follows playback

## M4 — Packaging

- [ ] macOS installer (target-triple sidecar binary)
- [ ] First-run model download with progress screen
- [ ] Loading state while model warms up
- [ ] Signing (only if needed for personal use)

## M5 — v2 (optional)

- [ ] OCR for scanned PDFs (Tesseract)
- [ ] Piper engine
- [ ] Word-level highlight
- [ ] Voice per block type
- [ ] Export to audio files

---

## Decisions and findings log

Newest first. Update SPEC.md when a decision changes it.

| Date | Item | Decision / finding |
|---|---|---|
| 2026-11-23 | M0 sidecar lifecycle | Rust (not JS) spawns the sidecar via `tauri-plugin-shell`, passes `--port`/`--token`; UI polls `/health` with `X-Token`. PyInstaller onefile used (externalBin takes a single file; onedir needs resource bundling, deferred to M4). Orphan prevention: sidecar exits when its stdin closes. Rust toolchain upgraded 1.75 → 1.100 (Tauri 2 needs it). Python 3.12 venv via uv (system 3.14 too new for PyInstaller). |
| 2026-11-23 | Spec revision | Tauri 2 + React/TS + Python sidecar replaces browser + FastAPI design. macOS only, personal use, desktop only, block-level highlight. README and progress rewritten to match. Dropped from earlier design: SQLite library, pt-BR/i18n, per-chunk HTTP audio, 85/80% coverage gates. |

## Blockers and open questions

None.
