#!/usr/bin/env python3
"""Serve Kraken full-page OCR for the Edison Next.js ingest pipeline.

Uses the Kraken CLI (7.x) with CUDA by default. Serializes GPU work so parallel
Vercel chunk requests do not OOM a 4 GB T1200.
"""

from __future__ import annotations

import argparse
import asyncio
import io
import os
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--model",
        default=os.environ.get("EDISON_KRAKEN_MODEL", "ml/models/en_best.mlmodel"),
        help="Kraken recognition model (.mlmodel or .safetensors)",
    )
    parser.add_argument(
        "--device",
        default=os.environ.get("EDISON_KRAKEN_DEVICE", "cuda:0"),
        help="Kraken --device (cuda:0 or cpu)",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.environ.get("EDISON_KRAKEN_BATCH_SIZE", "16")),
        help="Recognition batch size (-B)",
    )
    parser.add_argument(
        "--precision",
        default=os.environ.get("EDISON_KRAKEN_PRECISION", "bf16-mixed"),
        help="Kraken --precision",
    )
    parser.add_argument(
        "--num-line-workers",
        type=int,
        default=int(os.environ.get("EDISON_KRAKEN_NUM_LINE_WORKERS", "4")),
        help="CPU line extraction workers",
    )
    parser.add_argument(
        "--ocr-secret",
        default=os.environ.get("EDISON_KRAKEN_OCR_SECRET", ""),
        help="If set, require X-Edison-Ocr-Secret header on /transcribe",
    )
    parser.add_argument(
        "--allow-cpu-fallback",
        action="store_true",
        help="Use CPU when CUDA is unavailable (debug only)",
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--model-label",
        default="local/kraken-en_best-v1",
        help="Value returned in JSON model field",
    )
    return parser.parse_args()


@dataclass
class KrakenRuntime:
    model_path: Path
    device: str
    batch_size: int
    precision: str
    num_line_workers: int
    model_label: str
    cuda_available: bool
    gpu_name: str | None
    gpu_lock: asyncio.Lock


def resolve_device(requested: str, allow_cpu_fallback: bool) -> tuple[str, bool, str | None]:
    try:
        import torch
    except ImportError as error:
        raise RuntimeError("Install torch (CUDA build) before serving Kraken OCR.") from error

    cuda = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if cuda else None
    if requested.startswith("cuda") and not cuda:
        if allow_cpu_fallback:
            return "cpu", False, None
        raise RuntimeError(
            f"Device {requested} requested but torch.cuda.is_available() is False. "
            "Install CUDA PyTorch or pass --allow-cpu-fallback."
        )
    return requested, cuda, gpu_name


def transcribe_image_sync(runtime: KrakenRuntime, image_path: Path) -> tuple[str, list[dict[str, Any]]]:
    """Run Kraken segment + OCR on one page image; return page text and line records."""
    cmd = [
        "kraken",
        "-i",
        str(image_path),
        "stdout",
        "--device",
        runtime.device,
        "--precision",
        runtime.precision,
        "segment",
        "-bl",
        "ocr",
        "-m",
        str(runtime.model_path),
        "-B",
        str(runtime.batch_size),
        "--num-line-workers",
        str(runtime.num_line_workers),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        raise RuntimeError(stderr or f"kraken exited with {result.returncode}")

    text = (result.stdout or "").strip()
    lines: list[dict[str, Any]] = []
    if text:
        for index, line in enumerate(text.splitlines()):
            stripped = line.strip()
            if stripped:
                lines.append({"lineIndex": index, "text": stripped})
    return text, lines


def create_runtime(args: argparse.Namespace) -> KrakenRuntime:
    model_path = Path(args.model)
    if not model_path.exists():
        raise RuntimeError(f"Kraken model not found: {model_path}")

    device, cuda_available, gpu_name = resolve_device(
        args.device,
        args.allow_cpu_fallback,
    )
    if subprocess.run(["kraken", "--help"], capture_output=True).returncode != 0:
        raise RuntimeError("kraken CLI is not on PATH. Install kraken>=7.")

    return KrakenRuntime(
        model_path=model_path,
        device=device,
        batch_size=args.batch_size,
        precision=args.precision,
        num_line_workers=args.num_line_workers,
        model_label=args.model_label,
        cuda_available=cuda_available,
        gpu_name=gpu_name,
        gpu_lock=asyncio.Lock(),
    )


def build_app(runtime: KrakenRuntime, ocr_secret: str):
    try:
        from fastapi import FastAPI, File, Header, HTTPException, UploadFile
        from PIL import Image
    except ImportError as error:
        raise RuntimeError(
            "Install fastapi, uvicorn, python-multipart, and pillow."
        ) from error

    app = FastAPI(title="Edison Kraken Local OCR")

    @app.get("/health")
    async def health():
        return {
            "ok": True,
            "cuda": runtime.cuda_available,
            "device": runtime.gpu_name or runtime.device,
            "kraken_device": runtime.device,
            "kraken_batch_size": runtime.batch_size,
            "model": runtime.model_label,
            "model_path": str(runtime.model_path),
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
                text, lines = await asyncio.to_thread(
                    transcribe_image_sync,
                    runtime,
                    temp_path,
                )
        except RuntimeError as error:
            if "cuda" in str(error).lower() or "out of memory" in str(error).lower():
                raise HTTPException(status_code=503, detail=str(error)) from error
            raise HTTPException(status_code=500, detail=str(error)) from error
        finally:
            temp_path.unlink(missing_ok=True)

        return {
            "ocrText": text,
            "model": runtime.model_label,
            "promptVersion": "local-kraken-v1",
            "uncertainReadings": [],
            "pages": [
                {
                    "pageIndex": 0,
                    "text": text,
                    "lines": lines,
                }
            ],
        }

    return app


def main() -> int:
    args = parse_args()
    try:
        import uvicorn
    except ImportError as error:
        raise RuntimeError("Install uvicorn to serve Kraken OCR.") from error

    runtime = create_runtime(args)
    print(
        f"Kraken OCR: device={runtime.device} cuda={runtime.cuda_available} "
        f"gpu={runtime.gpu_name or 'n/a'} batch={runtime.batch_size} "
        f"model={runtime.model_path}",
    )
    app = build_app(runtime, args.ocr_secret.strip())
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
