#!/usr/bin/env python3
"""Serve Qwen2.5-VL OCR for the Edison Vercel ingest pipeline.

Exposes the same HTTP contract as the legacy Kraken server:
  GET  /health
  POST /transcribe  (multipart file + optional mediaType)

Run on an Amarel GPU node with the model pre-downloaded. Pair with Cloudflare
Tunnel (or similar) so Vercel can reach EDISON_LOCAL_OCR_URL / EDISON_REMOTE_OCR_URL.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import os
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from transcribe_qwen_vl import (  # noqa: E402
    DEFAULT_MODEL_DIR,
    MODEL_LABEL,
    PROMPT_VERSION,
    QwenVlTranscriber,
)
from vision_transcribe import DIPLOMATIC_PROMPT, parse_transcription_lines  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--host", default=os.environ.get("EDISON_OCR_HOST", "0.0.0.0"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("EDISON_OCR_PORT", "8787")))
    parser.add_argument(
        "--dtype",
        choices=("bf16", "4bit"),
        default=os.environ.get("EDISON_QWEN_DTYPE", "bf16"),
        help="bf16 on Amarel L40S; 4bit for low-VRAM laptops",
    )
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument(
        "--ocr-secret",
        default=os.environ.get("EDISON_OCR_SECRET", ""),
        help="If set, require X-Edison-Ocr-Secret header on /transcribe",
    )
    parser.add_argument(
        "--model-label",
        default=os.environ.get("EDISON_QWEN_MODEL_LABEL", MODEL_LABEL),
    )
    return parser.parse_args()


@dataclass
class QwenBf16Transcriber:
    model_dir: Path
    max_new_tokens: int = 1024
    model_label: str = MODEL_LABEL
    _model: object | None = None
    _processor: object | None = None

    def _load(self) -> None:
        if self._model is not None and self._processor is not None:
            return

        try:
            import torch
            from qwen_vl_utils import process_vision_info
            from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration
        except ImportError as error:
            raise RuntimeError(
                "Qwen VLM import failed. Install: pip install -r ml/requirements-qwen-vl.txt"
            ) from error

        if not self.model_dir.exists():
            raise RuntimeError(
                f"Model not found at {self.model_dir}. "
                "Run: hf download Qwen/Qwen2.5-VL-7B-Instruct --local-dir <path>"
            )
        if not torch.cuda.is_available():
            raise RuntimeError("bf16 mode requires CUDA (use --dtype 4bit for CPU offload).")

        self._torch = torch
        self._process_vision_info = process_vision_info
        self._model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
            str(self.model_dir),
            torch_dtype=torch.bfloat16,
            device_map="cuda:0",
        )
        self._processor = AutoProcessor.from_pretrained(
            str(self.model_dir),
            min_pixels=256 * 28 * 28,
            max_pixels=1280 * 28 * 28,
        )

    def transcribe_page(self, image_path: Path) -> tuple[list[str], str]:
        self._load()
        image_path = image_path.resolve()
        if not image_path.exists():
            raise RuntimeError(f"Image not found: {image_path}")

        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "image": str(image_path)},
                    {"type": "text", "text": DIPLOMATIC_PROMPT},
                ],
            }
        ]
        text = self._processor.apply_chat_template(  # type: ignore[union-attr]
            messages,
            tokenize=False,
            add_generation_prompt=True,
        )
        image_inputs, video_inputs = self._process_vision_info(messages)
        inputs = self._processor(  # type: ignore[union-attr]
            text=[text],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        )
        inputs = inputs.to("cuda:0")

        with self._torch.no_grad():
            generated_ids = self._model.generate(  # type: ignore[union-attr]
                **inputs,
                max_new_tokens=self.max_new_tokens,
            )
        generated_ids_trimmed = [
            out_ids[len(in_ids) :]
            for in_ids, out_ids in zip(inputs.input_ids, generated_ids)
        ]
        raw = self._processor.batch_decode(  # type: ignore[union-attr]
            generated_ids_trimmed,
            skip_special_tokens=True,
            clean_up_tokenization_spaces=False,
        )[0].strip()

        lines = parse_transcription_lines(raw)
        if not lines and raw.strip():
            lines = [raw.strip()]
        return lines, raw

    def to_contract(self, lines: list[str]) -> dict[str, Any]:
        text = "\n".join(lines)
        return {
            "ocrText": text,
            "model": self.model_label,
            "promptVersion": PROMPT_VERSION,
            "uncertainReadings": [],
            "pages": [
                {
                    "pageIndex": 0,
                    "text": text,
                    "lines": [{"lineIndex": index, "text": line} for index, line in enumerate(lines)],
                }
            ],
        }


@dataclass
class QwenOcrRuntime:
    transcriber: QwenVlTranscriber | QwenBf16Transcriber
    model_label: str
    dtype: str
    gpu_lock: asyncio.Lock
    cuda_available: bool
    gpu_name: str | None


def create_runtime(args: argparse.Namespace) -> QwenOcrRuntime:
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("Install torch before serving Qwen OCR.") from error

    cuda = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if cuda else None

    if args.dtype == "bf16":
        transcriber: QwenVlTranscriber | QwenBf16Transcriber = QwenBf16Transcriber(
            model_dir=args.model_dir,
            max_new_tokens=args.max_new_tokens,
            model_label=args.model_label,
        )
    else:
        transcriber = QwenVlTranscriber(
            model_dir=args.model_dir,
            max_new_tokens=args.max_new_tokens,
            cpu_offload=False if cuda else True,
        )

    return QwenOcrRuntime(
        transcriber=transcriber,
        model_label=args.model_label,
        dtype=args.dtype,
        gpu_lock=asyncio.Lock(),
        cuda_available=cuda,
        gpu_name=gpu_name,
    )


def transcribe_image_sync(runtime: QwenOcrRuntime, image_path: Path) -> dict[str, Any]:
    lines, _raw = runtime.transcriber.transcribe_page(image_path)
    if isinstance(runtime.transcriber, QwenBf16Transcriber):
        return runtime.transcriber.to_contract(lines)
    return runtime.transcriber.to_contract(lines)


def build_app(runtime: QwenOcrRuntime, ocr_secret: str):
    try:
        from fastapi import FastAPI, File, Header, HTTPException, UploadFile
        from PIL import Image
    except ImportError as error:
        raise RuntimeError("Install fastapi, uvicorn, python-multipart, and pillow.") from error

    app = FastAPI(title="Edison Qwen OCR")

    @app.get("/health")
    async def health():
        return {
            "ok": True,
            "cuda": runtime.cuda_available,
            "device": runtime.gpu_name or "cpu",
            "dtype": runtime.dtype,
            "model": runtime.model_label,
        }

    @app.post("/transcribe")
    async def transcribe(
        file: UploadFile = File(...),
        x_edison_ocr_secret: str | None = Header(default=None),
    ):
        if ocr_secret and x_edison_ocr_secret != ocr_secret:
            raise HTTPException(status_code=401, detail="Invalid OCR secret.")

        contents = await file.read()
        suffix = ".jpg"
        if file.content_type and "png" in file.content_type.lower():
            suffix = ".png"
        elif file.content_type and "tif" in file.content_type.lower():
            suffix = ".tif"

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            temp_path = Path(handle.name)
            image = Image.open(io.BytesIO(contents))
            image.convert("RGB").save(temp_path)

        try:
            async with runtime.gpu_lock:
                payload = await asyncio.to_thread(
                    transcribe_image_sync,
                    runtime,
                    temp_path,
                )
        except RuntimeError as error:
            message = str(error)
            if "cuda" in message.lower() or "out of memory" in message.lower():
                raise HTTPException(status_code=503, detail=message) from error
            raise HTTPException(status_code=500, detail=message) from error
        finally:
            temp_path.unlink(missing_ok=True)

        return payload

    return app


def main() -> int:
    args = parse_args()
    try:
        import uvicorn
    except ImportError as error:
        raise RuntimeError("Install uvicorn to serve Qwen OCR.") from error

    runtime = create_runtime(args)
    print(
        f"Qwen OCR: dtype={runtime.dtype} cuda={runtime.cuda_available} "
        f"gpu={runtime.gpu_name or 'n/a'} model={args.model_dir}",
        file=sys.stderr,
    )
    app = build_app(runtime, args.ocr_secret.strip())
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
