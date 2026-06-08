#!/usr/bin/env python3
"""v5 training set: trustworthy Scripto pages + tier-A v4 pages (frozen test excluded)."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from prepare_finetune_v4 import frozen_test_ids, load_rows, quality_tier  # noqa: E402
from prepare_quality_v5 import label_is_trustworthy, quality_tier as scripto_tier  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument(
        "--frozen-test-manifest",
        type=Path,
        default=Path("ml/data/manifests/kraken_gt_manifest.pre_upgrade.jsonl"),
    )
    parser.add_argument("--train-list", type=Path, default=Path("ml/data/manifests/v5_train_pagexml.txt"))
    parser.add_argument("--frozen-test-list", type=Path, default=Path("ml/data/manifests/frozen_test_52_pagexml.txt"))
    parser.add_argument("--curation-report", type=Path, default=Path("ml/reports/v5_curation.jsonl"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    frozen = frozen_test_ids(args.frozen_test_manifest)
    rows = load_rows(args.manifest)

    train_paths: set[str] = set()
    frozen_paths: set[str] = set()
    curated: list[dict[str, Any]] = []

    for row in rows:
        page_id = str(row.get("id", ""))
        pagexml = row.get("pagexml_path")
        if not pagexml or not Path(str(pagexml)).exists():
            continue
        path = str(Path(str(pagexml)))

        if page_id in frozen:
            frozen_paths.add(path)
            continue

        tier: str | None = None
        if label_is_trustworthy(row):
            tier = scripto_tier(row, frozen)
        if tier is None:
            v4_tier = quality_tier(row, frozen)
            if v4_tier == "train_tier_a":
                tier = "train_tier_a_supplement"

        if tier is None:
            continue

        train_paths.add(path)
        curated.append({**row, "v5_tier": tier})

    if not train_paths:
        raise SystemExit("No v5 training pages after combined curation.")

    args.train_list.parent.mkdir(parents=True, exist_ok=True)
    args.train_list.write_text("\n".join(sorted(train_paths)) + "\n", encoding="utf-8")
    args.frozen_test_list.parent.mkdir(parents=True, exist_ok=True)
    args.frozen_test_list.write_text("\n".join(sorted(frozen_paths)) + "\n", encoding="utf-8")

    args.curation_report.parent.mkdir(parents=True, exist_ok=True)
    with args.curation_report.open("w", encoding="utf-8") as handle:
        for record in curated:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    scripto = sum(1 for r in curated if r.get("v5_tier") in {"train_tier_a", "train_tier_b"})
    supplement = sum(1 for r in curated if r.get("v5_tier") == "train_tier_a_supplement")
    print(f"Frozen test pages: {len(frozen_paths)}")
    print(f"Train pages: {len(train_paths)} (scripto={scripto}, tier_a_supplement={supplement})")
    print(f"Wrote {args.train_list}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
