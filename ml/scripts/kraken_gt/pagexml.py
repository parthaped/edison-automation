#!/usr/bin/env python3
"""Write Kraken-compatible PAGE XML."""

from __future__ import annotations

import os
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

from kraken_gt.regions import ClassifiedLine, group_lines_by_region


PAGE_NS = "http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15"
XSI_NS = "http://www.w3.org/2001/XMLSchema-instance"
ET.register_namespace("", PAGE_NS)
ET.register_namespace("xsi", XSI_NS)


def _points_attr(points: list[tuple[int, int]]) -> str:
    return " ".join(f"{x},{y}" for x, y in points)


def _region_coords(lines: list[ClassifiedLine]) -> list[tuple[int, int]]:
    xs: list[int] = []
    ys: list[int] = []
    for line in lines:
        for x, y in line.segment.boundary:
            xs.append(x)
            ys.append(y)
    if not xs:
        return [(0, 0), (1, 0), (1, 1), (0, 1)]
    pad = 4
    return [
        (max(0, min(xs) - pad), max(0, min(ys) - pad)),
        (max(xs) + pad, max(0, min(ys) - pad)),
        (max(xs) + pad, max(ys) + pad),
        (max(0, min(xs) - pad), max(ys) + pad),
    ]


def write_pagexml(
    output_path: Path,
    image_path: Path,
    image_width: int,
    image_height: int,
    classified_lines: list[ClassifiedLine],
    pagexml_root: Path | None = None,
) -> None:
    root = ET.Element(
        f"{{{PAGE_NS}}}PcGts",
        {
            f"{{{XSI_NS}}}schemaLocation": (
                f"{PAGE_NS} "
                "http://schema.primaresearch.org/PAGE/gts/pagecontent/2019-07-15/pagecontent.xsd"
            ),
        },
    )

    metadata = ET.SubElement(root, f"{{{PAGE_NS}}}Metadata")
    creator = ET.SubElement(metadata, f"{{{PAGE_NS}}}Creator")
    creator.text = "edison-papers-research build_kraken_ground_truth"
    created = ET.SubElement(metadata, f"{{{PAGE_NS}}}Created")
    created.text = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    try:
        image_filename = Path(
            os.path.relpath(Path(image_path).resolve(), output_path.parent.resolve())
        ).as_posix()
    except ValueError:
        image_filename = str(image_path).replace("\\", "/")

    page = ET.SubElement(
        root,
        f"{{{PAGE_NS}}}Page",
        {
            "imageFilename": image_filename,
            "imageWidth": str(image_width),
            "imageHeight": str(image_height),
        },
    )

    for region_index, (region_type, region_lines) in enumerate(group_lines_by_region(classified_lines)):
        region = ET.SubElement(
            page,
            f"{{{PAGE_NS}}}TextRegion",
            {
                "id": f"region_{region_index:04d}",
                "custom": f"type {{type:{region_type};}}",
            },
        )
        coords = ET.SubElement(region, f"{{{PAGE_NS}}}Coords")
        coords.set("points", _points_attr(_region_coords(region_lines)))

        for line_index, line in enumerate(region_lines):
            text_line = ET.SubElement(
                region,
                f"{{{PAGE_NS}}}TextLine",
                {"id": f"line_{region_index:04d}_{line_index:04d}"},
            )
            line_coords = ET.SubElement(text_line, f"{{{PAGE_NS}}}Coords")
            line_coords.set("points", _points_attr(line.segment.boundary))
            if line.segment.baseline:
                baseline = ET.SubElement(text_line, f"{{{PAGE_NS}}}Baseline")
                baseline.set("points", _points_attr(line.segment.baseline))
            text_equiv = ET.SubElement(text_line, f"{{{PAGE_NS}}}TextEquiv")
            unicode = ET.SubElement(text_equiv, f"{{{PAGE_NS}}}Unicode")
            unicode.text = line.reference_text

    output_path.parent.mkdir(parents=True, exist_ok=True)
    tree = ET.ElementTree(root)
    if hasattr(ET, "indent"):
        ET.indent(tree, space="  ")
    tree.write(output_path, encoding="UTF-8", xml_declaration=True)
