#!/usr/bin/env python3
"""Curate phase-2/phase-3 Kraken training pages from kraken_gt_manifest.jsonl.

Uses label_source confidence tiers and optional tier-B inclusion.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("ml/data/manifests/phase2_curation.jsonl"),
    )
    parser.add_argument(
        "--train-list",
        type=Path,
        default=Path("ml/data/manifests/phase2_train_pagexml.txt"),
    )
    parser.add_argument(
        "--min-match-ratio",
        type=float,
        default=0.72,
        help="Minimum matched_lines / training_lines for tier-A training.",
    )
    parser.add_argument(
        "--max-median-cer",
        type=float,
        default=0.32,
        help="Maximum median line-match CER for tier-A training.",
    )
    parser.add_argument(
        "--max-mean-cer",
        type=float,
        default=0.42,
        help="Maximum mean line-match CER for tier-A training.",
    )
    parser.add_argument(
        "--min-matched-lines",
        type=int,
        default=4,
        help="Minimum aligned lines required on a page.",
    )
    parser.add_argument(
        "--min-validated-lines",
        type=int,
        default=3,
        help="Minimum lines that passed forced-alignment validation (when used).",
    )
    parser.add_argument(
        "--train-splits",
        default="train,validation",
        help="Comma-separated document splits included in training compile.",
    )
    parser.add_argument(
        "--include-tier-b",
        action="store_true",
        help="Include train_tier_b pages in the training PAGE XML list.",
    )
    return parser.parse_args()


def load_manifest(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def _alignment_tier(row: dict[str, Any], args: argparse.Namespace) -> str:
    matched = int(row.get("matched_lines") or 0)
    validated = int(row.get("validated_lines") or matched)
    if matched < args.min_matched_lines or validated < args.min_validated_lines:
        return "excluded_low_lines"
    ratio = float(row.get("match_ratio") or 0.0)
    median_cer = float(row.get("median_match_cer") or 1.0)
    mean_cer = float(row.get("mean_match_cer") or 1.0)
    if (
        ratio >= args.min_match_ratio
        and median_cer <= args.max_median_cer
        and mean_cer <= args.max_mean_cer
    ):
        return "train_tier_a"
    if ratio >= 0.65 and median_cer <= 0.40 and mean_cer <= 0.48 and matched >= 3:
        return "train_tier_b"
    return "excluded_quality"


def tier_for_row(row: dict[str, Any], args: argparse.Namespace) -> str:
    if row.get("status") != "accepted":
        return "excluded"
    if "label_conflict" in (row.get("quality_flags") or []):
        return "excluded"
    if str(row.get("transcript_type", "")) == "summary" and row.get("label_source") == "scripto":
        return "excluded"

    split = str(row.get("split", "train"))
    if split == "test":
        return "eval_holdout"

    label_source = str(row.get("label_source", "scripto"))
    vision_provider = str(row.get("vision_provider", ""))

    if label_source == "scripto_vision_agreed":
        return _alignment_tier(row, args)

    if label_source == "scripto":
        return _alignment_tier(row, args)

    if label_source == "vision_primary":
        if vision_provider == "kraken_baseline":
            return "train_tier_b" if float(row.get("match_ratio") or 0) >= 0.65 else "excluded_quality"
        if float(row.get("match_ratio") or 0) >= 0.65:
            return _alignment_tier(row, args)
        return "excluded_quality"

    if label_source in {"ocr_assisted", "ocr_assisted"}:
        return _alignment_tier(row, args)

    return _alignment_tier(row, args)


def main() -> int:
    args = parse_args()
    if not args.manifest.exists():
        raise SystemExit(f"Manifest not found: {args.manifest}")

    train_splits = {part.strip() for part in args.train_splits.split(",") if part.strip()}
    rows = load_manifest(args.manifest)
    curated: list[dict[str, Any]] = []
    train_paths: list[str] = []

    counts: dict[str, int] = {}
    for row in rows:
        tier = tier_for_row(row, args)
        counts[tier] = counts.get(tier, 0) + 1
        record = {**row, "phase2_tier": tier}
        curated.append(record)
        include = tier == "train_tier_a" or (args.include_tier_b and tier == "train_tier_b")
        if include and row.get("split") in train_splits:
            pagexml = row.get("pagexml_path")
            if pagexml and Path(pagexml).exists():
                train_paths.append(str(Path(pagexml)))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for record in curated:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    args.train_list.parent.mkdir(parents=True, exist_ok=True)
    args.train_list.write_text("\n".join(sorted(set(train_paths))) + ("\n" if train_paths else ""), encoding="utf-8")

    print(f"Accepted pages in manifest: {len(rows)}", file=sys.stderr)
    for tier, count in sorted(counts.items()):
        print(f"  {tier}: {count}", file=sys.stderr)
    print(f"Training PAGE XML files: {len(train_paths)}", file=sys.stderr)
    print(f"Wrote {args.output}")
    print(f"Wrote {args.train_list}")
    return 0 if train_paths else 1


if __name__ == "__main__":
    raise SystemExit(main())
