#!/usr/bin/env python3
"""Verify gold-set PAGE XML against the review checklist in gold-set-workflow.md."""

from __future__ import annotations

import argparse
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--page-list",
        type=Path,
        default=Path("ml/data/manifests/gold_set_pagexml.txt"),
    )
    parser.add_argument(
        "--images-root",
        type=Path,
        default=Path("ml/data/raw"),
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=Path("ml/reports/gold_set_verification.jsonl"),
    )
    return parser.parse_args()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def verify_page(xml_path: Path, images_root: Path) -> dict[str, Any]:
    issues: list[str] = []
    root = ET.parse(xml_path).getroot()
    page = next(element for element in root.iter() if local_name(element.tag) == "Page")
    image_filename = page.attrib.get("imageFilename", "")
    if not image_filename:
        issues.append("missing_image_filename")
    else:
        candidates = [
            Path(image_filename),
            xml_path.parent / image_filename,
            images_root / image_filename,
        ]
        if not any(path.exists() for path in candidates):
            issues.append("image_not_found")

    line_count = 0
    labeled_lines = 0
    for line in (element for element in root.iter() if local_name(element.tag) == "TextLine"):
        line_count += 1
        has_baseline = any(local_name(child.tag) == "Baseline" for child in line)
        has_coords = any(
            local_name(child.tag) == "Coords" and child.attrib.get("points")
            for child in line
        )
        if not has_baseline and not has_coords:
            issues.append("line_missing_geometry")
        text = ""
        for child in line.iter():
            if local_name(child.tag) == "Unicode" and child.text:
                text = child.text.strip()
                break
        if text:
            labeled_lines += 1

    if line_count == 0:
        issues.append("no_text_lines")
    if labeled_lines == 0:
        issues.append("no_labeled_lines")

    return {
        "pagexml_path": str(xml_path).replace("\\", "/"),
        "line_count": line_count,
        "labeled_lines": labeled_lines,
        "ok": not issues,
        "issues": sorted(set(issues)),
    }


def main() -> int:
    args = parse_args()
    if not args.page_list.exists():
        raise SystemExit(f"Page list not found: {args.page_list}")

    paths = [
        Path(line.strip())
        for line in args.page_list.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not paths:
        raise SystemExit(f"No PAGE XML paths in {args.page_list}")

    args.report.parent.mkdir(parents=True, exist_ok=True)
    ok_count = 0
    with args.report.open("w", encoding="utf-8") as handle:
        for xml_path in paths:
            if not xml_path.exists():
                record = {
                    "pagexml_path": str(xml_path).replace("\\", "/"),
                    "ok": False,
                    "issues": ["pagexml_missing"],
                }
            else:
                record = verify_page(xml_path, args.images_root)
            if record["ok"]:
                ok_count += 1
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")

    print(f"Verified {len(paths)} gold-set pages: {ok_count} ok, {len(paths) - ok_count} with issues.")
    print(f"Wrote {args.report}")
    return 0 if ok_count == len(paths) else 1


if __name__ == "__main__":
    raise SystemExit(main())
