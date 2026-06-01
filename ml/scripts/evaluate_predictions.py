#!/usr/bin/env python3
"""Compute CER/WER for Edison OCR prediction JSONL files."""

from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--predictions", type=Path, required=True)
    parser.add_argument("--output-jsonl", type=Path, default=Path("ml/reports/evaluation.jsonl"))
    parser.add_argument("--summary-csv", type=Path, default=Path("ml/reports/evaluation_summary.csv"))
    return parser.parse_args()


def levenshtein(reference: list[str], prediction: list[str]) -> int:
    previous = list(range(len(prediction) + 1))
    for i, ref_item in enumerate(reference, start=1):
        current = [i]
        for j, pred_item in enumerate(prediction, start=1):
            cost = 0 if ref_item == pred_item else 1
            current.append(
                min(
                    previous[j] + 1,
                    current[j - 1] + 1,
                    previous[j - 1] + cost,
                )
            )
        previous = current
    return previous[-1]


def cer(reference: str, prediction: str) -> float:
    if not reference:
        return 0.0 if not prediction else 1.0
    return levenshtein(list(reference), list(prediction)) / len(reference)


def wer(reference: str, prediction: str) -> float:
    reference_words = reference.split()
    prediction_words = prediction.split()
    if not reference_words:
        return 0.0 if not prediction_words else 1.0
    return levenshtein(reference_words, prediction_words) / len(reference_words)


def main() -> int:
    args = parse_args()
    rows: list[dict[str, object]] = []
    with args.predictions.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            reference = str(row.get("reference", ""))
            prediction = str(row.get("prediction", ""))
            row["cer"] = cer(reference, prediction)
            row["wer"] = wer(reference, prediction)
            rows.append(row)

    args.output_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with args.output_jsonl.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    grouped: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        grouped.setdefault(str(row.get("model", "unknown")), []).append(row)

    with args.summary_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["model", "count", "avg_cer", "avg_wer"])
        writer.writeheader()
        for model, model_rows in sorted(grouped.items()):
            writer.writerow(
                {
                    "model": model,
                    "count": len(model_rows),
                    "avg_cer": sum(float(row["cer"]) for row in model_rows) / len(model_rows),
                    "avg_wer": sum(float(row["wer"]) for row in model_rows) / len(model_rows),
                }
            )

    print(f"Wrote scored predictions to {args.output_jsonl}")
    print(f"Wrote summary to {args.summary_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
