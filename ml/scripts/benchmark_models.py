#!/usr/bin/env python3
"""Run lightweight OCR/HTR benchmark adapters over the same manifest.

Adapters are intentionally optional. If a model stack is not installed, the
script reports the skipped adapter instead of failing the whole benchmark.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

from evaluate_predictions import cer, wer


PredictionFn = Callable[[dict[str, object]], str]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/line_crops.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("ml/reports/benchmark_predictions.jsonl"))
    parser.add_argument("--models", default="trocr-small,trocr-base,grm-ocr")
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/edison-htr.mlmodel"))
    return parser.parse_args()


def load_manifest(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                row = json.loads(line)
                if row.get("split") == "test":
                    rows.append(row)
    return rows


def trocr_predictor(model_name: str) -> PredictionFn:
    try:
        import torch
        from PIL import Image
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel
    except ImportError as error:
        raise RuntimeError("TrOCR dependencies are not installed") from error

    processor = TrOCRProcessor.from_pretrained(model_name)
    model = VisionEncoderDecoderModel.from_pretrained(model_name)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model.to(device)
    model.eval()

    def predict(row: dict[str, object]) -> str:
        image = Image.open(str(row["image_path"])).convert("RGB")
        pixel_values = processor(image, return_tensors="pt").pixel_values.to(device)
        generated_ids = model.generate(pixel_values)
        return processor.batch_decode(generated_ids, skip_special_tokens=True)[0]

    return predict


def grm_ocr_predictor() -> PredictionFn:
    try:
        import torch
        from PIL import Image
        from transformers import AutoModelForCausalLM
    except ImportError as error:
        raise RuntimeError("GRM-OCR dependencies are not installed") from error

    model = AutoModelForCausalLM.from_pretrained(
        "OrionLLM/GRM-OCR",
        trust_remote_code=True,
        torch_dtype=torch.bfloat16,
        device_map="auto",
    )

    def predict(row: dict[str, object]) -> str:
        image = Image.open(str(row["image_path"])).convert("RGB")
        return model.generate(image, category="text")[0]

    return predict


def kraken_predictor(model_path: Path) -> PredictionFn:
    if not model_path.exists():
        raise RuntimeError(f"Kraken model does not exist: {model_path}")
    if subprocess.run(["kraken", "--help"], capture_output=True).returncode != 0:
        raise RuntimeError("kraken CLI is not installed")

    def predict(row: dict[str, object]) -> str:
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as handle:
            output_path = Path(handle.name)
        try:
            subprocess.run(
                [
                    "kraken",
                    "-i",
                    str(row["image_path"]),
                    str(output_path),
                    "ocr",
                    "-m",
                    str(model_path),
                ],
                check=True,
                capture_output=True,
                text=True,
            )
            return output_path.read_text(encoding="utf-8").strip()
        finally:
            output_path.unlink(missing_ok=True)

    return predict


def build_predictor(name: str, kraken_model: Path) -> tuple[str, PredictionFn]:
    if name == "trocr-small":
        return "microsoft/trocr-small-handwritten", trocr_predictor("microsoft/trocr-small-handwritten")
    if name == "trocr-base":
        return "microsoft/trocr-base-handwritten", trocr_predictor("microsoft/trocr-base-handwritten")
    if name == "grm-ocr":
        return "OrionLLM/GRM-OCR", grm_ocr_predictor()
    if name == "kraken":
        return f"kraken/{kraken_model.name}", kraken_predictor(kraken_model)
    raise RuntimeError(f"Unknown benchmark model adapter: {name}")


def main() -> int:
    args = parse_args()
    rows = load_manifest(args.manifest)
    if not rows:
        raise RuntimeError(f"No test rows found in {args.manifest}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    selected = [name.strip() for name in args.models.split(",") if name.strip()]
    with args.output.open("w", encoding="utf-8") as handle:
        for selected_name in selected:
            try:
                model_label, predict = build_predictor(selected_name, args.kraken_model)
            except RuntimeError as error:
                print(f"Skipping {selected_name}: {error}", file=sys.stderr)
                continue

            for row in rows:
                reference = str(row.get("text", ""))
                prediction = predict(row)
                output = {
                    "id": row.get("id"),
                    "model": model_label,
                    "reference": reference,
                    "prediction": prediction,
                    "cer": cer(reference, prediction),
                    "wer": wer(reference, prediction),
                    "split": row.get("split", "test"),
                }
                handle.write(json.dumps(output, ensure_ascii=False, sort_keys=True) + "\n")

    print(f"Wrote benchmark predictions to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
