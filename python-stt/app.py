from __future__ import annotations

import os
import tempfile
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, File, Header, HTTPException, UploadFile
from faster_whisper import WhisperModel

API_KEY = os.getenv("STT_API_KEY", "change-me")
MODEL_SIZE = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("WHISPER_COMPUTE_TYPE", "int8")
MAX_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(15 * 1024 * 1024)))

app = FastAPI(title="Local Whisper STT", version="1.0.0")


@lru_cache(maxsize=1)
def get_model() -> WhisperModel:
    return WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "model": MODEL_SIZE, "device": DEVICE}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    x_api_key: str | None = Header(default=None),
) -> dict[str, object]:
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid API key")

    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="Audio file is too large")

    suffix = Path(file.filename or "voice.ogg").suffix or ".ogg"
    tmp_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        segments, info = get_model().transcribe(
            tmp_path,
            beam_size=3,
            vad_filter=True,
        )
        text = " ".join(segment.text.strip() for segment in segments).strip()
        return {
            "text": text,
            "language": getattr(info, "language", None),
            "language_probability": getattr(info, "language_probability", None),
        }
    finally:
        if tmp_path:
            try:
                os.remove(tmp_path)
            except FileNotFoundError:
                pass
