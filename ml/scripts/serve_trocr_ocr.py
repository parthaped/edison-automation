#!/usr/bin/env python3
"""Serve a TrOCR-compatible local OCR endpoint for the Next.js app.

This is a lightweight integration harness. It is best for cropped line images
or already-segmented page regions; full-page historical manuscripts still need
layout segmentation upstream.
"""

from __future__ import annotations

import argparse
import io
from dataclasses import dataclass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="ml/models/trocr-edison")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    return parser.parse_args()


@dataclass
class OcrRuntime:
    processor: object
    model: object
    device: str
    model_name: str


def create_runtime(model_name: str) -> OcrRuntime:
    try:
        import torch
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    except ImportError as error:
        raise RuntimeError("Install torch and transformers to serve TrOCR OCR.") from error

    processor = TrOCRProcessor.from_pretrained(model_name)
    model = VisionEncoderDecoderModel.from_pretrained(model_name)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    model.eval()
    return OcrRuntime(processor=processor, model=model, device=device, model_name=model_name)


def build_app(runtime: OcrRuntime):
    try:
        import torch
        from fastapi import FastAPI, File, UploadFile
        from PIL import Image
    except ImportError as error:
        raise RuntimeError(
            "Install fastapi, uvicorn, python-multipart, pillow, and torch to serve OCR."
        ) from error

    app = FastAPI(title="Edison Local OCR")

    @app.post("/transcribe")
    async def transcribe(file: UploadFile = File(...)):
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert("RGB")
        pixel_values = runtime.processor(image, return_tensors="pt").pixel_values.to(runtime.device)
        with torch.no_grad():
            generated_ids = runtime.model.generate(pixel_values)
        text = runtime.processor.batch_decode(generated_ids, skip_special_tokens=True)[0]
        return {
            "ocrText": text,
            "model": runtime.model_name,
            "promptVersion": "local-htr-v1",
            "uncertainReadings": [],
            "pages": [
                {
                    "pageIndex": 0,
                    "text": text,
                    "lines": [{"lineIndex": 0, "text": text}],
                }
            ],
        }

    return app


def main() -> int:
    args = parse_args()
    try:
        import uvicorn
    except ImportError as error:
        raise RuntimeError("Install uvicorn to serve local OCR.") from error

    runtime = create_runtime(args.model)
    app = build_app(runtime)
    uvicorn.run(app, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
