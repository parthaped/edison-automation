#!/usr/bin/env python3
"""Compare local OCR outputs against a Gemini pseudo-ground-truth transcription."""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import tempfile
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from evaluate_predictions import cer, wer  # noqa: E402
from label_provider import load_local_env, resolve_label_provider  # noqa: E402
from pdf_page_utils import load_page_images  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True)
    parser.add_argument("--predictions", action="append", required=True, help="model_name=path/to.txt")
    parser.add_argument("--output-dir", type=Path, default=Path("ml/reports/ocr_comparison"))
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--skip-gemini", action="store_true")
    parser.add_argument("--gemini-cache", type=Path, default=Path("ml/data/cache/vision_labels"))
    return parser.parse_args()


def normalize_text(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n+", "\n", text)
    return text.strip().lower()


def parse_prediction_arg(raw: str) -> tuple[str, Path]:
    if "=" not in raw:
        raise RuntimeError(f"Expected model=path, got: {raw}")
    model, path = raw.split("=", 1)
    model = model.strip()
    path = Path(path.strip())
    if not path.is_absolute():
        path = REPO_ROOT / path
    if not path.exists():
        raise RuntimeError(f"Prediction file not found: {path}")
    return model, path


def transcribe_pdf_with_gemini(pdf_path: Path, dpi: int, cache_dir: Path) -> tuple[str, list[dict[str, object]]]:
    load_local_env()
    provider = resolve_label_provider("gemini")
    pages = load_page_images(pdf_path, dpi=dpi)
    page_rows: list[dict[str, object]] = []
    all_lines: list[str] = []

    with tempfile.TemporaryDirectory(prefix="gemini_ocr_") as temp_dir:
        temp_root = Path(temp_dir)
        for page_id, image in pages:
            image_path = temp_root / f"{page_id}.png"
            image.save(image_path, format="PNG")
            started = time.perf_counter()
            lines = provider.transcribe_page(image_path)
            elapsed = time.perf_counter() - started
            page_text = "\n".join(lines)
            all_lines.extend(lines)
            page_rows.append(
                {
                    "page_id": page_id,
                    "provider": provider.name,
                    "line_count": len(lines),
                    "elapsed_s": round(elapsed, 1),
                    "text": page_text,
                }
            )

    cache_dir.mkdir(parents=True, exist_ok=True)
    reference_path = cache_dir / f"{pdf_path.stem}.gemini_reference.txt"
    reference_path.write_text("\n".join(all_lines) + ("\n" if all_lines else ""), encoding="utf-8")
    return "\n".join(all_lines), page_rows


def main() -> int:
    args = parse_args()
    pdf_path = args.pdf if args.pdf.is_absolute() else REPO_ROOT / args.pdf
    if not pdf_path.exists():
        raise SystemExit(f"PDF not found: {pdf_path}")

    output_dir = args.output_dir if args.output_dir.is_absolute() else REPO_ROOT / args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    predictions = [parse_prediction_arg(item) for item in args.predictions]

    if args.skip_gemini:
        reference_path = args.gemini_cache / f"{pdf_path.stem}.gemini_reference.txt"
        if not reference_path.exists():
            raise SystemExit(f"Gemini reference not found: {reference_path}")
        reference_raw = reference_path.read_text(encoding="utf-8")
        gemini_pages: list[dict[str, object]] = []
    else:
        print(f"Transcribing {pdf_path.name} with Gemini...", flush=True)
        reference_raw, gemini_pages = transcribe_pdf_with_gemini(pdf_path, args.dpi, args.gemini_cache)
        gemini_path = output_dir / f"{pdf_path.stem}.gemini_reference.txt"
        gemini_path.write_text(reference_raw + ("\n" if reference_raw else ""), encoding="utf-8")
        with (output_dir / f"{pdf_path.stem}.gemini_pages.json").open("w", encoding="utf-8") as handle:
            json.dump(gemini_pages, handle, ensure_ascii=False, indent=2)
        print(f"Saved Gemini reference to {gemini_path}", flush=True)

    reference = normalize_text(reference_raw)
    rows: list[dict[str, object]] = []
    for model, path in predictions:
        prediction_raw = path.read_text(encoding="utf-8")
        prediction = normalize_text(prediction_raw)
        rows.append(
            {
                "model": model,
                "prediction_path": str(path),
                "cer": round(cer(reference, prediction), 4),
                "wer": round(wer(reference, prediction), 4),
                "char_accuracy": round((1.0 - cer(reference, prediction)) * 100, 2),
                "word_accuracy": round((1.0 - wer(reference, prediction)) * 100, 2),
                "reference_chars": len(reference),
                "prediction_chars": len(prediction),
            }
        )

    rows.sort(key=lambda item: float(item["cer"]))
    summary_csv = output_dir / f"{pdf_path.stem}.comparison.csv"
    with summary_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "model",
                "cer",
                "wer",
                "char_accuracy",
                "word_accuracy",
                "reference_chars",
                "prediction_chars",
                "prediction_path",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)

    print("", flush=True)
    print(f"Gemini pseudo-ground-truth ({len(reference)} chars, normalized)", flush=True)
    print(f"Comparison summary: {summary_csv}", flush=True)
    print("", flush=True)
    for row in rows:
        print(
            f"- {row['model']}: CER {row['cer']:.4f} | WER {row['wer']:.4f} | "
            f"char acc {row['char_accuracy']:.1f}% | word acc {row['word_accuracy']:.1f}%",
            flush=True,
        )

    winner = rows[0]["model"] if rows else "none"
    print("", flush=True)
    print(f"Best vs Gemini reference: {winner}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
