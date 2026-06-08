#!/usr/bin/env python3
"""Compare Kraken benchmark predictions against vision-OCR reference."""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from evaluate_predictions import cer  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--kraken-predictions",
        type=Path,
        default=Path("ml/reports/benchmark_predictions.jsonl"),
    )
    parser.add_argument(
        "--reference-predictions",
        type=Path,
        default=Path("ml/reports/benchmark_vision_ocr.jsonl"),
    )
    parser.add_argument("--output", type=Path, default=Path("ml/reports/reference_comparison.csv"))
    parser.add_argument("--near-correct-threshold", type=float, default=0.10)
    parser.add_argument("--target-ratio", type=float, default=0.80)
    return parser.parse_args()


def load_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    if not path.exists():
        return rows
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def aggregate_kraken_by_page(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    """Roll line-level Kraken predictions up to page-level for fair comparison."""
    from collections import defaultdict

    grouped: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in rows:
        source = str(row.get("source_image_path") or "")
        if not source:
            continue
        grouped[source].append(row)

    aggregated: list[dict[str, object]] = []
    for source, line_rows in grouped.items():
        line_rows.sort(key=lambda item: str(item.get("id", "")))
        reference = "\n".join(str(item.get("reference", "")) for item in line_rows if item.get("reference"))
        prediction = "\n".join(str(item.get("prediction", "")) for item in line_rows if item.get("prediction"))
        aggregated.append(
            {
                "model": str(line_rows[0].get("model", "kraken")),
                "reference": reference,
                "prediction": prediction,
                "cer": cer(reference, prediction),
                "source_image_path": source,
            }
        )
    return aggregated


def summarize(rows: list[dict[str, object]], near_threshold: float) -> dict[str, float | int | str]:
    if not rows:
        return {"model": "none", "count": 0, "char_accuracy": 0.0, "near_correct_pct": 0.0, "avg_cer": 1.0}
    model = str(rows[0].get("model", "unknown"))
    cers = [float(row.get("cer", 1.0)) for row in rows]
    near = sum(1 for value in cers if value <= near_threshold)
    avg_cer = sum(cers) / len(cers)
    return {
        "model": model,
        "count": len(rows),
        "char_accuracy": round((1.0 - avg_cer) * 100, 2),
        "near_correct_pct": round(near / len(cers) * 100, 2),
        "avg_cer": round(avg_cer, 4),
    }


def main() -> int:
    args = parse_args()
    kraken_rows = aggregate_kraken_by_page(load_jsonl(args.kraken_predictions))
    reference_rows = load_jsonl(args.reference_predictions)

    kraken_summary = summarize(kraken_rows, args.near_correct_threshold)
    reference_summary = summarize(reference_rows, args.near_correct_threshold)

    ref_acc = float(reference_summary["char_accuracy"])
    kra_acc = float(kraken_summary["char_accuracy"])
    ratio = (kra_acc / ref_acc) if ref_acc > 0 else 0.0

    ref_near = float(reference_summary["near_correct_pct"])
    kra_near = float(kraken_summary["near_correct_pct"])
    near_ratio = (kra_near / ref_near) if ref_near > 0 else 0.0

    rows = [
        {**reference_summary, "metric": "reference"},
        {**kraken_summary, "metric": "kraken"},
        {
            "model": "kraken_vs_reference",
            "count": min(int(kraken_summary["count"]), int(reference_summary["count"])),
            "char_accuracy": round(ratio * 100, 2),
            "near_correct_pct": round(near_ratio * 100, 2),
            "avg_cer": round(1.0 - ratio, 4),
            "metric": "ratio_pct",
            "meets_target": ratio >= args.target_ratio,
        },
    ]

    args.output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["metric", "model", "count", "char_accuracy", "near_correct_pct", "avg_cer", "meets_target"]
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    print(f"Wrote {args.output}")
    print(
        f"Kraken char accuracy {kra_acc:.1f}% vs reference {ref_acc:.1f}% "
        f"(ratio {ratio:.1%}, target {args.target_ratio:.0%})",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
