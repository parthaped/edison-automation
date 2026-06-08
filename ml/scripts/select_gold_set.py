#!/usr/bin/env python3
"""Select a diverse 50-page gold set from kraken_gt_manifest.jsonl.

Targets the composition in ml/docs/gold-set-workflow.md:
  30 correspondence, 10 notebook/list, 10 hard pages.

When eScriptorium manual review is unavailable, tier-A Scripto-aligned
PAGE XML in ml/data/pagexml/ serves as the training gold set source.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import xml.etree.ElementTree as ET
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
        "--output-manifest",
        type=Path,
        default=Path("ml/data/manifests/gold_set_manifest.jsonl"),
    )
    parser.add_argument(
        "--page-list",
        type=Path,
        default=Path("ml/data/manifests/gold_set_pagexml.txt"),
    )
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--correspondence", type=int, default=30)
    parser.add_argument("--notebook", type=int, default=10)
    parser.add_argument("--hard", type=int, default=10)
    parser.add_argument(
        "--min-match-ratio",
        type=float,
        default=0.72,
        help="Minimum match_ratio for tier-A quality pages.",
    )
    parser.add_argument(
        "--max-median-cer",
        type=float,
        default=0.32,
        help="Maximum median_match_cer for tier-A quality pages.",
    )
    return parser.parse_args()


def load_manifest(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def pagexml_has_marginalia(pagexml_path: Path) -> bool:
    if not pagexml_path.exists():
        return False
    root = ET.parse(pagexml_path).getroot()
    for element in root.iter():
        if local_name(element.tag) != "TextRegion":
            continue
        custom = element.attrib.get("custom", "")
        region_type = element.attrib.get("type", "")
        if "marginal" in custom or "marginal" in region_type:
            return True
    return False


def tier_a(row: dict[str, Any], args: argparse.Namespace) -> bool:
    if row.get("status") != "accepted" or row.get("quality_flags"):
        return False
    ratio = float(row.get("match_ratio") or 0.0)
    median_cer = float(row.get("median_match_cer") or 1.0)
    return ratio >= args.min_match_ratio and median_cer <= args.max_median_cer


def category_for(row: dict[str, Any]) -> str:
    document_id = str(row.get("document_id", ""))
    document_type = str(row.get("document_type", "")).lower()
    if document_id.startswith("LM") or "notebook" in document_type or "list" in document_type:
        return "notebook"
    if document_type in {"letter", "correspondence", "memo", "telegram"}:
        return "correspondence"
    if document_id.startswith("LB"):
        return "correspondence"
    return "correspondence"


def hard_score(row: dict[str, Any]) -> float:
    median_cer = float(row.get("median_match_cer") or 0.0)
    mean_cer = float(row.get("mean_match_cer") or 0.0)
    ratio = float(row.get("match_ratio") or 0.0)
    pagexml = Path(str(row.get("pagexml_path", "")))
    marginal = 1.0 if pagexml_has_marginalia(pagexml) else 0.0
    return median_cer * 2.0 + mean_cer + (1.0 - ratio) + marginal


def pick_diverse(
    candidates: list[dict[str, Any]],
    count: int,
    rng: random.Random,
    key_fn,
) -> list[dict[str, Any]]:
    if len(candidates) <= count:
        return sorted(candidates, key=key_fn)
    ranked = sorted(candidates, key=key_fn)
    if count <= 1:
        return ranked[:count]
    step = max(1, len(ranked) // count)
    picked: list[dict[str, Any]] = []
    used_ids: set[str] = set()
    for index in range(0, len(ranked), step):
        row = ranked[index]
        row_id = str(row.get("id", ""))
        if row_id in used_ids:
            continue
        picked.append(row)
        used_ids.add(row_id)
        if len(picked) >= count:
            break
    if len(picked) < count:
        for row in ranked:
            row_id = str(row.get("id", ""))
            if row_id in used_ids:
                continue
            picked.append(row)
            used_ids.add(row_id)
            if len(picked) >= count:
                break
    rng.shuffle(picked)
    return picked[:count]


def main() -> int:
    args = parse_args()
    if not args.manifest.exists():
        raise SystemExit(f"Manifest not found: {args.manifest}")

    rng = random.Random(args.seed)
    accepted = [row for row in load_manifest(args.manifest) if tier_a(row, args)]
    if not accepted:
        raise SystemExit("No tier-A accepted pages found in manifest.")

    by_doc: dict[str, list[dict[str, Any]]] = {}
    for row in accepted:
        by_doc.setdefault(str(row.get("document_id", "")), []).append(row)

    correspondence_pool: list[dict[str, Any]] = []
    notebook_pool: list[dict[str, Any]] = []
    hard_pool: list[dict[str, Any]] = []
    for row in accepted:
        category = category_for(row)
        if category == "notebook":
            notebook_pool.append(row)
        else:
            correspondence_pool.append(row)
        hard_pool.append(row)

    selected: list[dict[str, Any]] = []
    used_docs: set[str] = set()

    def take_from_pool(pool: list[dict[str, Any]], count: int, key_fn) -> None:
        nonlocal selected
        available = [
            row
            for row in pool
            if str(row.get("document_id", "")) not in used_docs
            and Path(str(row.get("pagexml_path", ""))).exists()
        ]
        picked = pick_diverse(available, count, rng, key_fn)
        for row in picked:
            selected.append({**row, "gold_category": "hard" if key_fn == hard_score else category_for(row)})
            used_docs.add(str(row.get("document_id", "")))

    take_from_pool(
        correspondence_pool,
        args.correspondence,
        lambda row: (float(row.get("median_match_cer") or 0.0), str(row.get("document_id", ""))),
    )
    take_from_pool(
        notebook_pool if notebook_pool else correspondence_pool,
        args.notebook,
        lambda row: (float(row.get("median_match_cer") or 0.0), str(row.get("document_id", ""))),
    )
    take_from_pool(hard_pool, args.hard, hard_score)

    target = args.correspondence + args.notebook + args.hard
    if len(selected) < target:
        remaining = [
            row
            for row in accepted
            if str(row.get("document_id", "")) not in used_docs
            and Path(str(row.get("pagexml_path", ""))).exists()
        ]
        rng.shuffle(remaining)
        for row in remaining:
            selected.append({**row, "gold_category": category_for(row)})
            used_docs.add(str(row.get("document_id", "")))
            if len(selected) >= target:
                break

    args.output_manifest.parent.mkdir(parents=True, exist_ok=True)
    with args.output_manifest.open("w", encoding="utf-8") as handle:
        for row in selected:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")

    page_paths = sorted(
        {
            str(Path(str(row.get("pagexml_path", ""))).resolve()).replace("\\", "/")
            for row in selected
            if row.get("pagexml_path")
        }
    )
    args.page_list.parent.mkdir(parents=True, exist_ok=True)
    args.page_list.write_text("\n".join(page_paths) + ("\n" if page_paths else ""), encoding="utf-8")

    categories = {}
    for row in selected:
        cat = row.get("gold_category", "unknown")
        categories[cat] = categories.get(cat, 0) + 1

    print(f"Selected {len(selected)} gold-set pages from {len(accepted)} tier-A candidates.", file=sys.stderr)
    print(f"  categories: {categories}", file=sys.stderr)
    print(f"  unique documents: {len(used_docs)}", file=sys.stderr)
    print(f"Wrote {args.output_manifest}")
    print(f"Wrote {args.page_list}")
    return 0 if len(selected) >= min(50, target) else 1


if __name__ == "__main__":
    raise SystemExit(main())
