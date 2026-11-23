import argparse
import os
import sys
import threading

import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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
    return {"status": "ok", "modelLoaded": False}


def exit_on_stdin_close() -> None:
    # The shell holds our stdin; EOF (quit or crash) means exit, so we never orphan.
    try:
        sys.stdin.read()
    finally:
        os._exit(0)


if __name__ == "__main__":
    threading.Thread(target=exit_on_stdin_close, daemon=True).start()
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
