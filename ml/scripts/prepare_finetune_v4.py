#!/usr/bin/env python3
"""Curate v4 fine-tune training pages: tier A+B, frozen 52-page test holdout excluded."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parents[1]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument(
        "--frozen-test-manifest",
        type=Path,
        default=Path("ml/data/manifests/kraken_gt_manifest.pre_upgrade.jsonl"),
    )
    parser.add_argument("--train-list", type=Path, default=Path("ml/data/manifests/finetune_v4_train_pagexml.txt"))
    parser.add_argument("--frozen-test-list", type=Path, default=Path("ml/data/manifests/frozen_test_52_pagexml.txt"))
    parser.add_argument("--curation-report", type=Path, default=Path("ml/reports/finetune_v4_curation.jsonl"))
    return parser.parse_args()


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def frozen_test_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {str(row["id"]) for row in load_rows(path) if row.get("split") == "test"}


def quality_tier(row: dict[str, Any], frozen: set[str]) -> str | None:
    page_id = str(row.get("id", ""))
    if page_id in frozen or row.get("split") == "test":
        return None
    if row.get("status") != "accepted":
        return None
    if str(row.get("transcript_type", "")) == "summary":
        return None
    if "label_conflict" in (row.get("quality_flags") or []):
        return None
    if row.get("split") not in {"train", "validation"}:
        return None

    ratio = float(row.get("match_ratio") or 0.0)
    mean_cer = float(row.get("mean_match_cer") or 1.0)
    median_cer = float(row.get("median_match_cer") or 1.0)
    training = max(int(row.get("training_lines") or 0), 1)
    segmented = int(row.get("segmented_lines") or 0)
    if segmented / training > 2.5:
        return None

    if ratio >= 0.78 and mean_cer <= 0.28 and median_cer <= 0.30:
        return "train_tier_a"
    if ratio >= 0.72 and mean_cer <= 0.35 and median_cer <= 0.38:
        return "train_tier_b"
    return None


def main() -> int:
    args = parse_args()
    frozen = frozen_test_ids(args.frozen_test_manifest)
    rows = load_rows(args.manifest)

    train_paths: list[str] = []
    frozen_paths: list[str] = []
    curated: list[dict[str, Any]] = []

    for row in rows:
        page_id = str(row.get("id", ""))
        pagexml = row.get("pagexml_path")
        if not pagexml or not Path(str(pagexml)).exists():
            continue

        if page_id in frozen:
            frozen_paths.append(str(Path(str(pagexml))))
            continue

        tier = quality_tier(row, frozen)
        if tier is None:
            continue

        curated.append({**row, "finetune_tier": tier})
        train_paths.append(str(Path(str(pagexml))))

    if not train_paths:
        raise SystemExit("No training pages after v4 curation.")

    args.train_list.parent.mkdir(parents=True, exist_ok=True)
    args.train_list.write_text("\n".join(sorted(set(train_paths))) + "\n", encoding="utf-8")

    args.frozen_test_list.parent.mkdir(parents=True, exist_ok=True)
    args.frozen_test_list.write_text("\n".join(sorted(set(frozen_paths))) + "\n", encoding="utf-8")

    args.curation_report.parent.mkdir(parents=True, exist_ok=True)
    with args.curation_report.open("w", encoding="utf-8") as handle:
        for record in curated:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    tier_a = sum(1 for r in curated if r.get("finetune_tier") == "train_tier_a")
    tier_b = sum(1 for r in curated if r.get("finetune_tier") == "train_tier_b")
    print(f"Frozen test pages: {len(set(frozen_paths))}")
    print(f"Train pages: {len(set(train_paths))} (tier_a={tier_a}, tier_b={tier_b})")
    print(f"Wrote {args.train_list}")
    print(f"Wrote {args.frozen_test_list}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
