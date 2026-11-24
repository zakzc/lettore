# Lettore — Implementation Progress

Tracks implementation against [SPEC.md](SPEC.md) (milestones in §8) and [README.md](README.md).

**Legend:** `[ ]` todo · `[~]` built, waiting for your check · `[x]` done and verified · `[!]` blocked (add a note)
**Last updated:** 2026-11-24

## Where we are

**Built through M3.8.** Everything works in tests; what is left is mostly checks only you can do (listening, looking).

**Next up:** your review of M3.5–M3.7 → M4 packaging (first-run model download, signing) → M4.5 main-body detection → M5 optimisation → M6 v2 → deferred M3.5 items as needed.

**Waiting on you (verification debt):**

1. M0: quit the app (Cmd+Q), then `pgrep -fl lettore-sidecar` must print nothing.
2. M1: skim a few of your PDFs with "Show block types" on; tell me which blocks are mislabelled.
3. M2/M3.7: listen for pauses at line, block and page breaks; they should now only sit on punctuation.
4. M3/M3.5: the PDF view, highlight, minimap, outline and dark mode look right in the real window.
5. M3.8: the blue underline follows the spoken sentence (also across a column or page break) and sits where you expect.
6. M3.6: Japanese and Chinese voices are listed but untested.

## Milestones

| Milestone | Status | Done |
|---|---|---|
| Spec | v0.6, decisions in §10 | — |
| M0 Spike | Built; shutdown check pending | 4 / 5 |
| M1 Extraction | Built; your eyeball review pending | 6 / 7 |
| M2 TTS | Built; listening check pending | 7 / 8 |
| M3 UI | Built; look-and-feel check pending | 9 / 10 |
| M3.5 UI improvements | First batch built; rest deferred | 4 / 10 |
| M3.6 Language and voice selector | Built | 4 / 4 |
| M3.7 Natural speech flow | Built; listening check pending | 3 / 4 |
| M3.8 Sentence underline | Built; look check pending | 4 / 5 |
| M4 Packaging | Not started | 0 / 4 |
| M4.5 Main-body detection | Not started (spike first) | 0 / 6 |
| M5 Extraction and voice optimisation | Not started | 0 / 9 |
| M6 v2 (optional) | Not started | 0 / 5 |

## How we work

1. Add the scope to SPEC §8 and a section here; record open questions (numbered) in the list at the bottom.
2. Build the smallest version; run only the relevant type check or targeted test (no test files added).
3. Rebuild the app (`npm run tauri build`; sidecar changes need `sidecar/build.sh` first) and hand it over with a short "what to check" list.
4. Your feedback goes into the next small step; decisions go into the log below, and SPEC changes in the same edit.
5. When you ask to consolidate: one commit per step, traceable to the spec. Nothing is pushed unless you ask.

---

## M0 — Spike

- [x] Tauri 2 + React + TS scaffold
- [x] Python sidecar (FastAPI) with `GET /health`, bundled via `bundle.externalBin`
- [x] Shell starts the sidecar on a random port with a token, UI waits for `/health`
- [x] UI shows the `/health` result
- [~] Clean shutdown: no orphaned sidecar or held port (onefile + stdin-close guard; **check 1 above**)

## M1 — Extraction

- [x] `POST /parse` → `{ docId, pages: [{ n, width, height, blocks }], toc }`
- [x] PyMuPDF block/span extraction (font size, weight, position)
- [x] Classification: heading, body, quote, footnote; header/footer/page number dropped
- [x] Cleaning: line joins, de-hyphenation, whitespace, ligatures, reading order for two columns
- [x] Block-type debug view (now "Show block types" in Settings)
- [~] Tested on 5–10 varied PDFs: 5 real PDFs plus one scanned (clean error); **check 2 above**
- Known gaps: bullet lists form one block; classifier is heuristic; rotated pages untested.

## M2 — TTS

- [x] Chunker (1–3 sentences); TTS engine interface; Kokoro via `kokoro-onnx` (int8 model; sidecar binary ≈120 MB)
- [x] `GET /voices`, `POST /stop`, `WS /speak` with acks and ≤3-chunk prefetch
- [x] Web Audio playback queue; play / pause / stop
- [~] Done when a loaded PDF is read aloud with working controls (**check 3 above**)

## M3 — UI

- [x] Load button (native file dialog); PDF view (pdf.js, lazy pages); block highlight with auto-scroll
- [x] Double-click anywhere on a page to read from the nearest block; skip paragraph back/forward; per-type skip toggles
- [x] Page minimap: wide column drawing the pages around you as lines of text (click/drag to scroll there, viewport box, spoken block in accent) plus a thin whole-document strip (jump to any page, heading ticks, spoken position)
- [x] Player card per the reference; Redux slices (`document`, `player`, plus `ui`)
- [~] Done when the UI matches the reference and the highlight follows playback (**check 4 above**)

## M3.5 — UI improvements

First batch (chosen 2026-11-24): calm reading-first look, auto/light/dark.

- [x] 1. Design pass (tokens, card, icons, dark mode)
- [x] 9. Settings panel; voice and speed on the player card
- [x] 4. Outline panel (PDF bookmarks, else detected headings)
- [x] 5. Resume position per file; settings persisted
- Deferred (see Backlog): 2, 3, 6, 7, 8, 10 (window size already done)

## M3.6 — Language and voice selector

- [x] `GET /voices` returns `{ id, name, lang, language, gender }`
- [x] Language select + voice select (that language only), in Settings and on the card
- [x] Voices shown by name ("Alex", not `pm_alex`)
- [x] Language persists through the saved voice

## M3.7 — Natural speech flow

- [x] Join body blocks that break mid-sentence (column/page breaks) before chunking
- [x] Consistent sentence-end pause at chunk boundaries; no silence added anywhere else
- [x] Resume/click inside a merged paragraph starts at the containing sentence
- [~] Listening check (**check 3 above**)

## M3.8 — Sentence underline

- [x] One chunk per sentence (abbreviation-aware), each with `spans` (block id + character range), also across merged column/page breaks
- [x] `POST /geometry` returns per-line rectangles for a span (PyMuPDF text search inside the block; run-of-words fallback; lines merged)
- [x] Blue underline on the page for the sentence being read; geometry for queued sentences is prefetched
- [x] Verified: 99.7% of 456 sampled sentence spans located on three real PDFs, 4–12 ms each
- [~] Look check (**check 5 above**): colour, thickness, position; Japanese/Chinese layouts untested

## M4 — Packaging

- [ ] macOS installer (target-triple sidecar binary; revisit onedir)
- [ ] First-run model download with a progress screen (today: manual download, see README)
- [ ] Loading state while the model warms up
- [ ] Signing (only if needed for personal use)

## M4.5 — Main-body detection

Goal: separate the main text from side notes, side summaries, callout boxes and margin comments, so they can be skipped (or read) deliberately. Best effort; layouts vary.

- [ ] Spike: on real PDFs (need samples with sidebars, see open question 2), list which signals exist: text outside the main column, narrower blocks, smaller/different font or colour, filled or ruled boxes behind text (`page.get_drawings()`)
- [ ] New block type `aside` (side note, summary box, callout) with a heuristic classifier in `parse.py`
- [ ] Reading order: keep asides out of the middle of a main paragraph (and out of the continuation joining in `chunker.py`)
- [ ] Settings: "Skip side notes" toggle (default per open question 1); block-type overlay colour for `aside`
- [ ] Outline/minimap unaffected by asides (headings inside asides are not outline entries)
- [ ] **Done when:** on your sample PDFs, the main text reads straight through with side material skipped, and the overlay shows what was classed as `aside`

## M5 — Extraction and voice optimisation

Extraction:

- [ ] Measure parse time and memory on large books; parse pages incrementally or cache the parse per file
- [ ] Tune the classifier with your corrections (headings, quotes, footnotes); keep the overlay as the review tool
- [ ] Better list handling (one block per item) and quote detection on indented text
- [ ] Rotated pages and unusual page boxes: align overlays

Voice:

- [ ] Faster time to first audio (smaller first chunk, warm model, prefetch tuning)
- [ ] Compare int8 against fp16/fp32 model quality and speed; try CoreML/ONNX execution providers
- [ ] Pause controls: pause-length slider, short pause after headings
- [ ] Optional voice blending for tone
- [ ] Per-language voice memory; default language from the detected document language
- [ ] **Done when:** noticeably faster open and start of reading on a large book, and a voice setup you prefer

## M6 — v2 (optional)

- [ ] OCR for scanned PDFs (Tesseract)
- [ ] Piper engine
- [ ] Word-level highlight
- [ ] Voice per block type
- [ ] Export to audio files

## Backlog (ideas, not scheduled)

- From M3.5: drag-and-drop and recent files · keyboard shortcuts (Space, ←/→, Cmd+O) · zoom/fit-width · reflowed reading mode · loading/error toasts · accessibility pass
- Speech: other engine for real emotion control (e.g. Chatterbox)
- (Speech tuning and extraction improvements moved into M5.)

---

## Decisions and findings log

Newest first. Update SPEC.md when a decision changes it.

| Date | Item | Decision / finding |
|---|---|---|
| 2026-11-24 | M3.8 sentence underline | Chose per-sentence chunks + `/geometry` over TTS word timings (the int8 Kokoro model exposes none) and over shipping per-character data (several MB per book). Cost: more, shorter chunks (prefetch raised 3 → 4); an ~10 ms lookup per sentence; ~0.3% of spans cannot be located (odd PDF spacing) and then show only the block highlight. Sentences that repeat inside one block underline the first match. Quotes closing a sentence are not underlined (the sentence splitter drops them). |
| 2026-11-24 | Bugfix: first double-click failed | Cause 1 (server): a chunk with nothing speakable (a lone bullet or ornament) made Kokoro raise `ValueError`, which `/speak` swallowed and closed the socket, shown as "sidecar closed the connection". Now such chunks are skipped and `chunkId` is renumbered at send time. Cause 2 (client): `play()` fired `POST /stop` for the old session, which could land on the new stream and cancel it; `play()` no longer calls `/stop` since a new `/speak` cancels the previous one. Verified with a PDF whose first block is a bullet. |
| 2026-11-24 | Minimap v2 | Wider minimap that draws blocks as stripes (from block bboxes, no page rendering, so cheap even for long books); shows a window of pages that follows the reader, because a whole 500-page book cannot be legible in one column. Thin strip kept for whole-document jumps. |
| 2026-11-24 | M3.7 speech flow | Measured: Kokoro leaves only ~0.1 s of silence at a chunk edge, so the audible "pause at line end" came from blocks that break mid-sentence (column/page breaks), each spoken as its own chunk with reset intonation. Fix: `chunker.py` joins such body blocks (no terminal punctuation + next starts lower case; de-hyphenates) into one paragraph before chunking, skipping footnotes in between; chunk `blockId` = block where the chunk starts, and resuming inside a merged paragraph starts at the containing sentence. Chunks that end a sentence get +0.15 s silence so boundaries match the 0.25 s in-chunk pause. Ebook sample: 4,924 blocks → 4,243 paragraphs. Highlight of a merged sentence changes at chunk, not block, granularity. Emotion/emphasis: not available in Kokoro (see SPEC §5.3). |
| 2026-11-24 | M3.6 voices | Language = Kokoro id prefix (`a`/`b` English US/UK, `e` Spanish, `f` French, `h` Hindi, `i` Italian, `j` Japanese, `p` Portuguese (Brazil), `z` Chinese); name = the part after `_`, title-cased. Language-switch picks the first voice of that language (no per-language memory yet). Japanese and Chinese voices are listed but not verified: Kokoro normally needs extra phonemiser packages for them. Spanish, Hindi and Italian have few voices. Moved here from M4. |
| 2026-11-24 | M3.5 first batch | Calm neutral palette with one accent (orange card kept), CSS tokens with auto/light/dark theme (PDF pages dimmed slightly in dark). Settings panel (voice, speed, skip chips, theme, block-type overlay); voice select and a speed chip on the player card, and a voice/speed change restarts from the current paragraph after 400 ms. Outline panel uses PDF bookmarks, else detected headings; click = go to page, ▶ = read from there. Persistence in localStorage (`lettore.settings`, `lettore.positions` keyed by file path, 200 most recent): Play resumes from the last block and the view scrolls there on open. Resume matches by block id (`p3b1`), so it breaks if the parser changes. |
| 2026-11-24 | M3.5 scope | First batch: design pass + dark mode, settings panel + quick controls, outline panel, resume/persisted settings. Direction: reading-first, calm, one accent colour. Shortcuts, drag-and-drop/recents, zoom, reading mode, loading/error states and the a11y pass are deferred. |
| 2026-11-24 | Navigation feedback | Minimap is a thin strip (one tick per heading, no thumbnails): cost is ~100 lines and no extra rendering, whereas thumbnails would mean rendering every page twice. Page mapping assumes similar page heights (scroll position ≈ page fraction). Start-reading moved from single- to double-click so stray clicks don't restart playback; it works anywhere on the page, not only on detected blocks. |
| 2026-11-24 | M3 UI | Sidecar now returns page width/height and serves the original file at `GET /doc/<id>/file` (pdf.js fetches it with the token, no fs plugin). Block `bbox` (PyMuPDF points, top-left origin) is drawn as a click overlay at the pdf.js scale; pages render lazily (IntersectionObserver) so big PDFs stay light. `/speak` takes `skipTypes`. Player card follows the reference: title, current section, ⏮ ⏯ ⏭, page x / n, progress bar (click = seek by block position, not audio time, since total duration is unknown). Redux: `document` and `player` slices; audio objects live in `player.ts`. Known risks: rotated pages may misalign overlays; skip/seek restart the stream (short gap); settings apply on next start. Path text box removed. |
| 2026-11-24 | M2 TTS | kokoro-onnx (ONNX runtime, no PyTorch) with the int8 model, ~3–6× faster than realtime on this Mac. Models live in `~/Library/Application Support/com.lettore.app/models` (manual download until M4's first-run flow, see README). `WS /speak?token=…` (browsers can't set WS headers) streams JSON `{chunkId, blockId, sampleRate, durationMs, audio: base64 int16 PCM}`; client acks each finished chunk and the server stays ≤3 chunks ahead (backpressure; pause just stalls the stream). `/stop` or a new `/speak` cancels the previous one. Language comes from the voice prefix (e.g. `pf_`/`pm_` = pt-br), so pick a matching voice for non-English PDFs. Footnotes are skipped; no extra pause for headings yet. int8 vs fp32 quality not compared. |
| 2026-11-23 | M1 extraction | Heuristic classifier in `sidecar/parse.py` (body size = modal by chars; heading ≥1.15× body or short bold; footnote = small + lower page; quote = italic/indented/quoted). Header/footer = margin text repeated ≥3 pages (digits normalised) or page-number pattern. Scanned PDFs return 422 (OCR is M6). Known gaps: paragraphs are not merged across blocks/pages; bullet lists form one block; no cap on huge docs in the debug view. UI uses a pasted path until M3 adds the file dialog. |
| 2026-11-23 | Repo made public | Licensed AGPL-3.0 (PyMuPDF is AGPL). README, SPEC §10.2 updated, LICENSE added. |
| 2026-11-23 | M0 sidecar lifecycle | Rust (not JS) spawns the sidecar via `tauri-plugin-shell`, passes `--port`/`--token`; UI polls `/health` with `X-Token`. PyInstaller onefile used (externalBin takes a single file; onedir needs resource bundling, deferred to M4). Orphan prevention: sidecar exits when its stdin closes. Rust toolchain upgraded 1.75 → 1.100 (Tauri 2 needs it). Python 3.12 venv via uv (system 3.14 too new for PyInstaller). |
| 2026-11-23 | Spec revision | Tauri 2 + React/TS + Python sidecar replaces browser + FastAPI design. macOS only, personal use, desktop only, block-level highlight. README and progress rewritten to match. Dropped from earlier design: SQLite library, pt-BR/i18n, per-chunk HTTP audio, 85/80% coverage gates. |

## Blockers and open questions

1. M4.5: should side notes be skipped by default, read after the section they belong to, or only when enabled?
2. M4.5: which of your PDFs have sidebars, margin notes or summary boxes? A few samples (path or description) make the spike far more reliable.
