import argparse
import asyncio
import base64
import os
import re
import sys
import threading

import pymupdf
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from chunker import chunk_blocks
from parse import parse_pdf
from tts import Engine, KokoroEngine

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, required=True)
parser.add_argument("--token", required=True)
args = parser.parse_args()

app = FastAPI()
# Token-gated and bound to 127.0.0.1, so any webview origin is acceptable.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def check_token(x_token: str | None = Header(default=None)) -> None:
    if x_token != args.token:
        raise HTTPException(status_code=401, detail="bad token")


@app.get("/health", dependencies=[Depends(check_token)])
def health() -> dict:
    return {"status": "ok", "modelLoaded": engine is not None, "modelError": engine_error}


engine: Engine | None = None
engine_error: str | None = None
DOCS: dict[str, dict] = {}  # docId -> {path, blocks (flat)}, for /speak and /doc/<id>/file
PREFETCH = 4  # chunks (sentences) the client may hold ahead of playback
active_cancel: asyncio.Event | None = None


def load_engine() -> None:
    global engine, engine_error
    try:
        engine = KokoroEngine()
    except Exception as e:  # missing model files, bad runtime, ...
        engine_error = f"cannot load TTS model: {e}"


@app.get("/voices", dependencies=[Depends(check_token)])
def voices() -> dict:
    if engine is None:
        raise HTTPException(status_code=503, detail=engine_error or "model still loading")
    return {"engine": "kokoro", "voices": engine.voices()}


@app.post("/stop", dependencies=[Depends(check_token)])
def stop() -> dict:
    if active_cancel is not None:
        active_cancel.set()
    return {"stopped": True}


@app.websocket("/speak")
async def speak(ws: WebSocket) -> None:
    global active_cancel
    if ws.query_params.get("token") != args.token:
        await ws.close(code=1008)
        return
    await ws.accept()
    if active_cancel is not None:
        active_cancel.set()
    cancel = active_cancel = asyncio.Event()
    acked, wake = 0, asyncio.Event()

    async def read_acks() -> None:
        nonlocal acked
        try:
            while True:
                msg = await ws.receive_json()
                if isinstance(msg, dict) and isinstance(msg.get("ack"), int):
                    acked = max(acked, msg["ack"] + 1)
                    wake.set()
        except (WebSocketDisconnect, RuntimeError, ValueError):
            cancel.set()
            wake.set()

    try:
        req = await ws.receive_json()
        doc = DOCS.get(str(req.get("docId")))
        if doc is None:
            await ws.send_json({"error": "unknown docId"})
            return
        if engine is None:
            await ws.send_json({"error": engine_error or "model still loading"})
            return
        voice = req.get("voice") or "af_heart"
        if voice not in {v["id"] for v in engine.voices()}:
            await ws.send_json({"error": f"unknown voice: {voice}"})
            return
        rate = req.get("rate")
        rate = min(max(float(rate), 0.5), 2.0) if isinstance(rate, (int, float)) else 1.0

        skip = {t for t in req.get("skipTypes") or [] if isinstance(t, str)}
        reader = asyncio.create_task(read_acks())
        sent = 0
        for c in chunk_blocks(doc["blocks"], req.get("fromBlockId"), skip):
            while sent - acked >= PREFETCH and not cancel.is_set():
                wake.clear()
                try:
                    await asyncio.wait_for(wake.wait(), 0.25)  # also re-checks /stop
                except asyncio.TimeoutError:
                    pass
            if cancel.is_set():
                break
            try:
                pcm, sr = await asyncio.to_thread(engine.synth, c["text"], voice, rate)
            except ValueError:
                continue  # nothing speakable (symbols, ornaments): skip the chunk, keep reading
            if cancel.is_set():
                break
            await ws.send_json({
                "chunkId": sent, "blockId": c["blockId"], "spans": c["spans"], "sampleRate": sr,
                "durationMs": round(len(pcm) / 2 / sr * 1000), "audio": base64.b64encode(pcm).decode(),
            })
            sent += 1
        if not cancel.is_set():
            await ws.send_json({"done": True})
        reader.cancel()
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass  # client went away or sent junk
    except Exception as e:
        try:
            await ws.send_json({"error": str(e)})
        except Exception:
            pass
    finally:
        cancel.set()
        try:
            await ws.close()
        except Exception:
            pass


class ParseRequest(BaseModel):
    path: str


@app.post("/parse", dependencies=[Depends(check_token)])
def parse(req: ParseRequest) -> dict:
    if not os.path.isfile(req.path):
        raise HTTPException(status_code=404, detail="file not found")
    try:
        doc = parse_pdf(req.path)
    except Exception as e:  # PyMuPDF raises various types for corrupt/non-PDF files
        raise HTTPException(status_code=422, detail=f"cannot parse PDF: {e}")
    blocks = [b for p in doc["pages"] for b in p["blocks"]]
    DOCS[doc["docId"]] = {"path": req.path, "blocks": blocks, "index": {b["id"]: b for b in blocks}}
    return doc


class GeometryRequest(BaseModel):
    docId: str
    blockId: str
    start: int
    end: int


def _merge_lines(rects: list) -> list[list[float]]:
    """Join rectangles on the same text line into one, so a sentence gets one continuous underline per line."""
    out: list[list[float]] = []
    for r in sorted(rects, key=lambda r: (round(r.y1), r.x0)):
        if out and abs(out[-1][3] - r.y1) < 2.5 and r.x0 - out[-1][2] < 8:
            out[-1][2] = max(out[-1][2], r.x1)
            out[-1][1] = min(out[-1][1], r.y0)
        else:
            out.append([r.x0, r.y0, r.x1, r.y1])
    return [[round(v, 1) for v in r] for r in out]


@app.post("/geometry", dependencies=[Depends(check_token)])
def geometry(req: GeometryRequest) -> dict:
    """Page rectangles (PDF points, top-left origin) covering block.text[start:end]; empty if it can't be located."""
    doc = DOCS.get(req.docId)
    block = doc["index"].get(req.blockId) if doc else None
    if block is None:
        raise HTTPException(status_code=404, detail="unknown block")
    text = block["text"][max(0, req.start) : max(0, req.end)].strip()
    m = re.match(r"p(\d+)b", block["id"])
    if not text or not m:
        return {"rects": []}
    try:
        with pymupdf.open(doc["path"]) as pdf:
            page = pdf[int(m.group(1)) - 1]
            clip = pymupdf.Rect(block["bbox"]) + (-2, -2, 2, 2)
            rects = page.search_for(text, clip=clip)
            if not rects:  # odd spacing/bullets in the PDF: locate runs of 4 words and underline the ones found
                words = text.split()
                for i in range(0, len(words), 4):
                    rects += page.search_for(" ".join(words[i : i + 4]), clip=clip)
    except Exception:
        return {"rects": []}
    return {"rects": _merge_lines(rects)}


@app.get("/doc/{doc_id}/file", dependencies=[Depends(check_token)])
def doc_file(doc_id: str) -> FileResponse:
    doc = DOCS.get(doc_id)
    if doc is None or not os.path.isfile(doc["path"]):
        raise HTTPException(status_code=404, detail="unknown document")
    return FileResponse(doc["path"], media_type="application/pdf")


def exit_on_stdin_close() -> None:
    # The shell holds our stdin; EOF (quit or crash) means exit, so we never orphan.
    try:
        sys.stdin.read()
    finally:
        os._exit(0)


if __name__ == "__main__":
    threading.Thread(target=exit_on_stdin_close, daemon=True).start()
    threading.Thread(target=load_engine, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
