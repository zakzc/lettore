import os
import threading
from typing import Protocol

import numpy as np

MODEL_DIR = os.path.expanduser("~/Library/Application Support/com.lettore.app/models")
MODEL_FILE, VOICES_FILE = "kokoro-v1.0.int8.onnx", "voices-v1.0.bin"
# Kokoro voice-id prefix (first letter) -> (espeak language, display label); e.g. "pf_dora" = Portuguese (Brazil), female
LANGS = {
    "a": ("en-us", "English (US)"), "b": ("en-gb", "English (UK)"), "e": ("es", "Spanish"), "f": ("fr-fr", "French"),
    "h": ("hi", "Hindi"), "i": ("it", "Italian"), "j": ("ja", "Japanese"), "p": ("pt-br", "Portuguese (Brazil)"),
    "z": ("cmn", "Chinese"),
}
GENDERS = {"f": "female", "m": "male"}


def describe_voice(voice_id: str) -> dict:
    prefix, _, rest = voice_id.partition("_")
    lang, label = LANGS.get(prefix[:1], ("en-us", "Other"))
    return {
        "id": voice_id,
        "name": (rest or voice_id).replace("_", " ").title(),
        "lang": lang,
        "language": label,
        "gender": GENDERS.get(prefix[1:2], ""),
    }


class Engine(Protocol):
    def voices(self) -> list[dict]:
        """Each voice: {id, name, lang, language, gender}."""
    def synth(self, text: str, voice: str, rate: float) -> tuple[bytes, int]:
        """Return (16-bit mono PCM bytes, sample rate)."""


class KokoroEngine:
    def __init__(self) -> None:
        from kokoro_onnx import Kokoro  # heavy import; keep out of sidecar startup path

        self._kokoro = Kokoro(os.path.join(MODEL_DIR, MODEL_FILE), os.path.join(MODEL_DIR, VOICES_FILE))
        self._lock = threading.Lock()

    def voices(self) -> list[dict]:
        return [describe_voice(v) for v in self._kokoro.get_voices()]

    def synth(self, text: str, voice: str, rate: float) -> tuple[bytes, int]:
        lang = LANGS.get(voice[:1], ("en-us",))[0]
        with self._lock:
            samples, sr = self._kokoro.create(text, voice=voice, speed=rate, lang=lang)
        # Sentences inside a chunk get a 0.25 s pause from Kokoro; make the chunk boundary match, and add nothing elsewhere.
        if text.rstrip("\"”’')]").endswith((".", "!", "?", "…")):
            samples = np.concatenate([samples, np.zeros(int(0.15 * sr), dtype=samples.dtype)])
        return (np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes(), sr
