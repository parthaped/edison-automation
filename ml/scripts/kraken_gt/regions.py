#!/usr/bin/env python3
"""Region typing for aligned lines."""

from __future__ import annotations

from dataclasses import dataclass

from kraken_gt.line_match import SegmentedLine
from kraken_gt.scripto import ParsedLine


SIGNATURE_PHRASES = (
    "yours truly",
    "yours very truly",
    "respectfully yours",
    "sincerely yours",
    "very sincerely yours",
)


@dataclass
class ClassifiedLine:
    reference_text: str
    segment: SegmentedLine
    region_type: str
    quality_flags: list[str]
    scripto_index: int
    match_cer: float


def _spatial_region(
    segment: SegmentedLine,
    page_width: int,
    page_height: int,
) -> str:
    x0, y0, x1, y1 = segment.bbox
    width = max(page_width, 1)
    height = max(page_height, 1)
    rel_y = segment.center_y / height
    rel_x = segment.center_x / width
    box_width = (x1 - x0) / width

    if rel_y <= 0.12:
        return "header"
    if rel_y >= 0.85:
        return "signature"
    if rel_x <= 0.18 or rel_x >= 0.82:
        if box_width <= 0.55:
            return "marginal"
    return "body"


def _text_region_hint(parsed: ParsedLine | None) -> str:
    if parsed is None:
        return "body"
    return parsed.region_hint or "body"


def _is_printed_letterhead(text: str, segment: SegmentedLine, page_height: int) -> bool:
    words = text.split()
    if not words:
        return False
    upper_ratio = sum(1 for word in words if word.isupper()) / len(words)
    rel_y = segment.center_y / max(page_height, 1)
    return upper_ratio >= 0.75 and len(text) >= 8 and rel_y <= 0.2


def classify_matched_line(
    reference_text: str,
    segment: SegmentedLine,
    parsed: ParsedLine | None,
    page_width: int,
    page_height: int,
    match_cer: float,
    scripto_index: int,
) -> ClassifiedLine:
    flags = list(parsed.quality_flags if parsed else [])
    lower = reference_text.lower()

    hint = _text_region_hint(parsed)
    spatial = _spatial_region(segment, page_width, page_height)

    region = hint
    if hint == "body":
        region = spatial
    if any(phrase in lower for phrase in SIGNATURE_PHRASES):
        region = "signature"
    if _is_printed_letterhead(reference_text, segment, page_height):
        region = "printed"
        if "printed" not in flags:
            flags.append("printed")

    if match_cer > 0.35:
        flags.append("uncertain")

    return ClassifiedLine(
        reference_text=reference_text,
        segment=segment,
        region_type=region,
        quality_flags=sorted(set(flags)),
        scripto_index=scripto_index,
        match_cer=match_cer,
    )


def group_lines_by_region(lines: list[ClassifiedLine]) -> list[tuple[str, list[ClassifiedLine]]]:
    if not lines:
        return []
    groups: list[tuple[str, list[ClassifiedLine]]] = []
    current_type = lines[0].region_type
    current: list[ClassifiedLine] = []
    for line in lines:
        if line.region_type != current_type and current:
            groups.append((current_type, current))
            current = []
            current_type = line.region_type
        current.append(line)
    if current:
        groups.append((current_type, current))
    return groups
