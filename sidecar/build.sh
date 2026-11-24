#!/bin/sh
# Builds the sidecar into src-tauri/binaries/lettore-sidecar-<target-triple> (Tauri externalBin naming).
set -e
cd "$(dirname "$0")"
[ -d .venv ] || uv venv --python 3.12 .venv
uv pip install -q --python .venv/bin/python -r requirements.txt
TRIPLE=$(rustc -vV | sed -n 's/host: //p')
.venv/bin/pyinstaller --onefile --collect-all kokoro_onnx --collect-all espeakng_loader --collect-all onnxruntime --collect-all phonemizer --name "lettore-sidecar-$TRIPLE" --distpath ../src-tauri/binaries --workpath build --specpath build main.py
