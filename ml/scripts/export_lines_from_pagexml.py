#!/usr/bin/env python3
"""Export PAGE XML TextLine entries to Hugging Face line-crop JSONL.

Cropping requires Pillow. Without --crop, the script still emits labels and
target crop paths so the manifest can be inspected before image generation.
"""

from __future__ import annotations

import argparse
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pagexml-dir", type=Path, default=Path("ml/data/pagexml"))
    parser.add_argument("--images-root", type=Path, default=Path("ml/data/raw"))
    parser.add_argument("--lines-root", type=Path, default=Path("ml/data/lines"))
    parser.add_argument("--output", type=Path, default=Path("ml/data/manifests/line_crops.jsonl"))
    parser.add_argument("--split", default="train", choices=["train", "validation", "test"])
    parser.add_argument("--crop", action="store_true", help="Crop line images with Pillow.")
    parser.add_argument("--padding", type=int, default=6, help="Crop padding in pixels.")
    return parser.parse_args()


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def children_named(element: ET.Element, name: str) -> list[ET.Element]:
    return [child for child in element.iter() if local_name(child.tag) == name]


def first_child_named(element: ET.Element, name: str) -> ET.Element | None:
    for child in element:
        if local_name(child.tag) == name:
            return child
    return None


def page_element(root: ET.Element) -> ET.Element:
    for element in root.iter():
        if local_name(element.tag) == "Page":
            return element
    raise ValueError("PAGE XML has no Page element")


def image_path_for(page: ET.Element, xml_path: Path, images_root: Path) -> Path:
    image_filename = page.attrib.get("imageFilename")
    if not image_filename:
        raise ValueError(f"{xml_path} Page element has no imageFilename")
    candidate = Path(image_filename)
    if candidate.is_absolute() and candidate.exists():
        return candidate
    xml_relative = xml_path.parent / candidate
    if xml_relative.exists():
        return xml_relative
    root_relative = images_root / candidate
    if root_relative.exists():
        return root_relative
    return root_relative


def points_to_bbox(points: str, padding: int) -> list[int]:
    pairs = re.findall(r"(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)", points)
    if not pairs:
        raise ValueError("No coordinate pairs found")
    xs = [float(x) for x, _ in pairs]
    ys = [float(y) for _, y in pairs]
    return [
        max(0, int(min(xs)) - padding),
        max(0, int(min(ys)) - padding),
        int(max(xs)) + padding,
        int(max(ys)) + padding,
    ]


def line_text(line: ET.Element) -> str:
    for child in line.iter():
        if local_name(child.tag) == "Unicode" and child.text:
            return child.text.strip()
    return ""


def region_type(region: ET.Element) -> str:
    custom = region.attrib.get("custom", "")
    match = re.search(r"type:([^;}]+)", custom)
    if match:
        return match.group(1).strip()
    return region.attrib.get("type", "body")


def iter_line_rows(xml_path: Path, args: argparse.Namespace) -> list[dict[str, Any]]:
    root = ET.parse(xml_path).getroot()
    page = page_element(root)
    image_path = image_path_for(page, xml_path, args.images_root)
    document_id = xml_path.stem
    rows: list[dict[str, Any]] = []
    page_index = 0
    line_index = 0
    for region in children_named(page, "TextRegion"):
        current_region_type = region_type(region)
        for line in children_named(region, "TextLine"):
            text = line_text(line)
            if not text:
                continue
            coords = first_child_named(line, "Coords")
            if coords is None or "points" not in coords.attrib:
                continue
            bbox = points_to_bbox(coords.attrib["points"], args.padding)
            line_id = f"{document_id}_p{page_index + 1:04d}_l{line_index + 1:04d}"
            extension = image_path.suffix or ".png"
            line_path = args.lines_root / document_id / f"p{page_index + 1:04d}_l{line_index + 1:04d}{extension}"
            rows.append(
                {
                    "id": line_id,
                    "document_id": document_id,
                    "page_index": page_index,
                    "line_index": line_index,
                    "image_path": str(line_path).replace("\\", "/"),
                    "source_image_path": str(image_path).replace("\\", "/"),
                    "bbox": bbox,
                    "text": text,
                    "region_type": current_region_type,
                    "writer_group": "unknown",
                    "split": args.split,
                    "quality_flags": [],
                }
            )
            line_index += 1
    return rows


def crop_rows(rows: list[dict[str, Any]]) -> None:
    try:
        from PIL import Image
    except ImportError as error:
        raise RuntimeError("Cropping requires Pillow: pip install pillow") from error

    open_images: dict[str, Any] = {}
    try:
        for row in rows:
            source = row["source_image_path"]
            if source not in open_images:
                open_images[source] = Image.open(source).convert("RGB")
            image = open_images[source]
            output = Path(row["image_path"])
            output.parent.mkdir(parents=True, exist_ok=True)
            image.crop(tuple(row["bbox"])).save(output)
    finally:
        for image in open_images.values():
            image.close()


def main() -> int:
    args = parse_args()
    rows: list[dict[str, Any]] = []
    for xml_path in sorted(args.pagexml_dir.glob("*.xml")):
        rows.extend(iter_line_rows(xml_path, args))
    if args.crop:
        crop_rows(rows)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
    print(f"Wrote {len(rows)} line rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
