#!/usr/bin/env python3
"""Benchmark vision-OCR label provider on line-crop or page manifests."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from evaluate_predictions import cer, wer  # noqa: E402
from label_provider import resolve_label_provider, transcribe_page_cached  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/line_crops_eval.jsonl"))
    parser.add_argument("--output", type=Path, default=Path("ml/reports/benchmark_vision_ocr.jsonl"))
    parser.add_argument("--split", default="test")
    parser.add_argument("--label-provider", default="auto", dest="label_provider")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--vision-cache-dir", type=Path, default=Path("ml/data/cache/vision_labels"))
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


def page_rows(rows: list[dict[str, object]]) -> dict[str, list[dict[str, object]]]:
    grouped: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        source = row.get("source_image_path") or row.get("image_path")
        if not source:
            continue
        key = str(source)
        grouped.setdefault(key, []).append(row)
    return grouped


def main() -> int:
    args = parse_args()
    rows = load_manifest(args.manifest, args.split)
    if not rows:
        raise SystemExit(f"No manifest rows for split={args.split}")

    provider = resolve_label_provider(args.label_provider, device=args.device)
    print(f"Benchmarking vision provider: {provider.name}", file=sys.stderr)

    grouped = page_rows(rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    predictions: list[dict[str, object]] = []

    for source_image, line_rows in grouped.items():
        image_path = Path(source_image)
        if not image_path.is_absolute():
            image_path = Path(__file__).resolve().parents[2] / image_path
        page_key = image_path.stem
        try:
            vision_lines, _ = transcribe_page_cached(
                provider, image_path, page_key, args.vision_cache_dir
            )
            page_prediction = "\n".join(vision_lines)
        except Exception as error:
            print(f"Skipping {page_key}: {error}", file=sys.stderr)
            continue

        references = [str(row.get("text", "")) for row in line_rows]
        reference = "\n".join(references)
        predictions.append(
            {
                "id": page_key,
                "model": f"vision/{provider.name}",
                "reference": reference,
                "prediction": page_prediction,
                "cer": cer(reference, page_prediction),
                "wer": wer(reference, page_prediction),
                "split": args.split,
                "source_image_path": str(image_path).replace("\\", "/"),
            }
        )

    with args.output.open("w", encoding="utf-8") as handle:
        for row in predictions:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    print(f"Wrote {len(predictions)} page predictions to {args.output}")
    return 0 if predictions else 1


if __name__ == "__main__":
    raise SystemExit(main())
