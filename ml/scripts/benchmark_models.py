#!/usr/bin/env python3
"""Run lightweight OCR/HTR benchmark adapters over the same manifest.

Adapters are intentionally optional. If a model stack is not installed, the
script reports the skipped adapter instead of failing the whole benchmark.

Kraken modes:
  recognition  — rpred on pre-cropped line images (matches ketos compile training)
  segment-ocr  — legacy segment+ocr on line crops (often mis-segments single lines)
  full-page    — segment+ocr on full source pages (matches serve_kraken_ocr.py)
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable

from evaluate_predictions import cer, wer


PredictionFn = Callable[[dict[str, object]], str]


def resolve_kraken_cli() -> str:
    venv_candidate = Path(sys.executable).with_name("kraken.exe" if os.name == "nt" else "kraken")
    if venv_candidate.exists():
        return str(venv_candidate)
    return "kraken"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/line_crops.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("ml/reports/benchmark_predictions.jsonl"))
    parser.add_argument("--models", default="kraken")
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/edison-htr.mlmodel"))
    parser.add_argument(
        "--kraken-mode",
        choices=["recognition", "segment-ocr", "full-page"],
        default="recognition",
        help="Kraken evaluation path (recognition matches training strips).",
    )
    parser.add_argument("--kraken-device", default="cuda:0")
    parser.add_argument("--kraken-batch-size", type=int, default=16)
    parser.add_argument("--kraken-precision", default="bf16-mixed")
    parser.add_argument("--kraken-num-line-workers", type=int, default=4)
    parser.add_argument(
        "--split",
        default="test",
        help="Manifest split to evaluate (default: test). Use 'all' for every row.",
    )
    return parser.parse_args()


def load_manifest(path: Path, split: str) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            row_split = str(row.get("split", "train"))
            if split == "all" or row_split == split:
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


def kraken_recognition_predictor(model_path: Path, device: str) -> PredictionFn:
    if not model_path.exists():
        raise RuntimeError(f"Kraken model does not exist: {model_path}")

    if model_path.suffix in {".safetensors", ".ckpt"}:
        from PIL import Image
        from kraken.binarization import nlbin
        from kraken.configs import RecognitionInferenceConfig
        from kraken.containers import BBoxLine, Segmentation
        from kraken.ketos.util import to_ptl_device
        from kraken.tasks import RecognitionTaskModel

        rec_model = RecognitionTaskModel.load_model(str(model_path))
        accelerator, ptl_device = to_ptl_device(device)
        precision = "bf16-mixed" if device.startswith("cuda") else "32-true"
        rec_config = RecognitionInferenceConfig(
            batch_size=16,
            precision=precision,
            accelerator=accelerator,
            device=ptl_device,
        )
        repo_root = Path(__file__).resolve().parents[2]

        def line_crop_segmentation(image_path: str, width: int, height: int) -> Segmentation:
            return Segmentation(
                type="bbox",
                imagename=image_path,
                text_direction="horizontal-lr",
                script_detection=False,
                lines=[BBoxLine(id="line_0", bbox=(0, 0, width, height))],
            )

        def predict_safetensors(row: dict[str, object]) -> str:
            image_path = Path(str(row["image_path"]))
            if not image_path.is_absolute():
                image_path = repo_root / image_path
            if not image_path.exists():
                raise RuntimeError(f"Line crop image not found: {image_path}")
            image = nlbin(Image.open(image_path).convert("RGB"))
            segmentation = line_crop_segmentation(str(image_path), image.width, image.height)
            records = list(rec_model.predict(image, segmentation, rec_config))
            if not records:
                return ""
            return str(records[0].prediction or "").strip()

        return predict_safetensors

    from PIL import Image

    from kraken.lib import models
    from kraken.rpred import rpred

    network = models.load_any(str(model_path), device=device)

    def predict(row: dict[str, object]) -> str:
        image = Image.open(str(row["image_path"])).convert("RGB")
        bounds = {"type": "baselines", "lines": [], "text_direction": "horizontal-lr"}
        prediction = rpred(network, image, bounds)
        lines = [line.prediction for line in prediction if line.prediction]
        return "\n".join(lines) if len(lines) > 1 else (lines[0] if lines else "")

    return predict


def kraken_cli_predictor(
    model_path: Path,
    device: str,
    batch_size: int,
    precision: str,
    num_line_workers: int,
    image_key: str,
) -> PredictionFn:
    if not model_path.exists():
        raise RuntimeError(f"Kraken model does not exist: {model_path}")
    kraken_cli = resolve_kraken_cli()
    if subprocess.run([kraken_cli, "--help"], capture_output=True).returncode != 0:
        raise RuntimeError("kraken CLI is not installed")

    def predict(row: dict[str, object]) -> str:
        image_path = str(row[image_key])
        result = subprocess.run(
            [
                kraken_cli,
                "-i",
                image_path,
                "stdout",
                "--device",
                device,
                "--precision",
                precision,
                "segment",
                "-bl",
                "ocr",
                "-m",
                str(model_path),
                "-B",
                str(batch_size),
                "--num-line-workers",
                str(num_line_workers),
            ],
            check=True,
            capture_output=True,
            text=True,
        )
        return (result.stdout or "").strip()

    return predict


def kraken_full_page_predictor(
    model_path: Path,
    device: str,
    batch_size: int,
    precision: str,
    num_line_workers: int,
) -> PredictionFn:
    """Evaluate full pages by joining predicted lines with newlines."""
    base = kraken_cli_predictor(
        model_path,
        device,
        batch_size,
        precision,
        num_line_workers,
        "source_image_path",
    )

    def predict(row: dict[str, object]) -> str:
        source = row.get("source_image_path")
        if not source:
            raise RuntimeError("full-page mode requires source_image_path in manifest row")
        return base({"source_image_path": source})

    return predict


def build_predictor(name: str, args: argparse.Namespace) -> tuple[str, PredictionFn]:
    if name == "trocr-small":
        return "microsoft/trocr-small-handwritten", trocr_predictor("microsoft/trocr-small-handwritten")
    if name == "trocr-base":
        return "microsoft/trocr-base-handwritten", trocr_predictor("microsoft/trocr-base-handwritten")
    if name == "grm-ocr":
        return "OrionLLM/GRM-OCR", grm_ocr_predictor()
    if name == "kraken":
        mode = args.kraken_mode
        if mode == "recognition":
            return (
                f"kraken/{args.kraken_model.name}#recognition",
                kraken_recognition_predictor(args.kraken_model, args.kraken_device),
            )
        if mode == "full-page":
            return (
                f"kraken/{args.kraken_model.name}#full-page",
                kraken_full_page_predictor(
                    args.kraken_model,
                    args.kraken_device,
                    args.kraken_batch_size,
                    args.kraken_precision,
                    args.kraken_num_line_workers,
                ),
            )
        return (
            f"kraken/{args.kraken_model.name}#segment-ocr",
            kraken_cli_predictor(
                args.kraken_model,
                args.kraken_device,
                args.kraken_batch_size,
                args.kraken_precision,
                args.kraken_num_line_workers,
                "image_path",
            ),
        )
    raise RuntimeError(f"Unknown benchmark model adapter: {name}")


def main() -> int:
    args = parse_args()
    rows = load_manifest(args.manifest, args.split)
    if not rows:
        raise RuntimeError(f"No rows found in {args.manifest} for split={args.split}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    selected = [name.strip() for name in args.models.split(",") if name.strip()]
    with args.output.open("w", encoding="utf-8") as handle:
        for selected_name in selected:
            try:
                model_label, predict = build_predictor(selected_name, args)
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
                    "split": row.get("split", args.split),
                    "source_image_path": row.get("source_image_path"),
                    "kraken_mode": args.kraken_mode if selected_name == "kraken" else None,
                }
                handle.write(json.dumps(output, ensure_ascii=False, sort_keys=True) + "\n")

    print(f"Wrote benchmark predictions to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
