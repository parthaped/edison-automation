#!/usr/bin/env python3
"""Hybrid Scripto + vision-OCR label fusion for PAGE XML ground truth."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from evaluate_predictions import cer
from kraken_gt.kraken_align import KrakenRuntime
from kraken_gt.line_match import sequence_align_lines, match_statistics
from kraken_gt.pagexml import write_pagexml
from kraken_gt.regions import ClassifiedLine, classify_matched_line
from kraken_gt.scripto import ParsedLine, parse_scripto_transcription, training_lines
from kraken_gt.transcript_validate import TranscriptValidation, classify_transcript

DEFAULT_MAX_LINE_CER = 0.85
MIN_VALIDATED_LINES = 4
MIN_MATCH_RATIO = 0.50


def align_scripto_to_segments(
    transcription: str,
    segmented: list,
    image_path: Path,
    image_size: tuple[int, int],
    runtime: KrakenRuntime,
    *,
    skip_forced_align: bool = False,
) -> tuple[list[ClassifiedLine], dict[str, Any]]:
    references = training_lines(parse_scripto_transcription(transcription))
    reference_texts = [line.text for line in references]
    matches = sequence_align_lines(reference_texts, segmented, max_pair_cer=DEFAULT_MAX_LINE_CER)
    parsed_by_index = {idx: line for idx, line in enumerate(references)}

    classified: list[ClassifiedLine] = []
    validated = 0
    for match in matches:
        parsed_line = parsed_by_index.get(match.scripto_index)
        if parsed_line is None:
            continue
        segment = segmented[match.segment_index]
        if not skip_forced_align and len(match.reference_text) <= 220:
            if not runtime.validate_forced_alignment(image_path, match.reference_text, segment):
                continue
        validated += 1
        classified.append(
            classify_matched_line(
                reference_text=match.reference_text,
                segment=segment,
                parsed=parsed_line,
                page_width=image_size[0],
                page_height=image_size[1],
                match_cer=match.match_cer,
                scripto_index=match.scripto_index,
            )
        )

    stats = match_statistics(len(reference_texts), len(segmented), matches)
    stats["validated_lines"] = validated
    if reference_texts:
        stats["match_ratio"] = validated / len(reference_texts)
    stats["training_lines"] = len(reference_texts)
    stats["segmented_lines"] = len(segmented)
    return classified, stats


def align_vision_lines_to_segments(
    vision_lines: list[str],
    segmented: list,
    image_size: tuple[int, int],
) -> tuple[list[ClassifiedLine], dict[str, Any]]:
    matches = sequence_align_lines(vision_lines, segmented, max_pair_cer=DEFAULT_MAX_LINE_CER)
    classified: list[ClassifiedLine] = []
    for match in matches:
        segment = segmented[match.segment_index]
        parsed = ParsedLine(text=match.reference_text, raw_text=match.reference_text, line_index=match.scripto_index)
        classified.append(
            classify_matched_line(
                reference_text=match.reference_text,
                segment=segment,
                parsed=parsed,
                page_width=image_size[0],
                page_height=image_size[1],
                match_cer=match.match_cer,
                scripto_index=match.scripto_index,
            )
        )
    stats = match_statistics(len(vision_lines), len(segmented), matches)
    stats["validated_lines"] = len(classified)
    if vision_lines:
        stats["match_ratio"] = len(classified) / len(vision_lines)
    stats["training_lines"] = len(vision_lines)
    stats["segmented_lines"] = len(segmented)
    return classified, stats


def fuse_scripto_and_vision(
    scripto_classified: list[ClassifiedLine],
    vision_classified: list[ClassifiedLine],
    *,
    transcript_type: str,
) -> tuple[list[ClassifiedLine], str, list[str]]:
    """Merge Scripto and vision-OCR lines; return (lines, label_source, quality_flags)."""
    if not vision_classified:
        return scripto_classified, "scripto", []

    if not scripto_classified:
        return vision_classified, "vision_primary", []

    vision_by_segment = {line.segment.index: line for line in vision_classified}
    fused: list[ClassifiedLine] = []
    agreements = 0
    conflicts = 0

    for scripto_line in scripto_classified:
        vision_line = vision_by_segment.get(scripto_line.segment.index)
        if vision_line is None:
            fused.append(scripto_line)
            continue
        score = cer(scripto_line.reference_text, vision_line.reference_text)
        if score <= 0.15:
            agreements += 1
            fused.append(scripto_line)
        elif score > 0.35 and transcript_type == "ambiguous":
            conflicts += 1
            fused.append(vision_line)
        else:
            if score > 0.35:
                conflicts += 1
            fused.append(scripto_line)

    quality_flags: list[str] = []
    if conflicts:
        quality_flags.append("label_conflict")

    if agreements >= 3 and conflicts == 0:
        return fused, "scripto_vision_agreed", quality_flags
    if transcript_type == "summary":
        return vision_classified, "vision_primary", quality_flags
    if conflicts and transcript_type == "ambiguous":
        return fused, "vision_primary", quality_flags
    return fused, "scripto", quality_flags


def acceptance_result(
    classified: list[ClassifiedLine],
    stats: dict[str, Any],
    *,
    label_source: str,
    transcript_validation: TranscriptValidation,
    vision_provider: str = "",
) -> dict[str, Any]:
    validated = int(stats.get("validated_lines") or len(classified))
    match_ratio = float(stats.get("match_ratio") or 0.0)
    base = {
        "validated_lines": validated,
        "matched_lines": stats.get("matched_lines", validated),
        "match_ratio": match_ratio,
        "mean_match_cer": stats.get("mean_match_cer", 0.0),
        "median_match_cer": stats.get("median_match_cer", 0.0),
        "training_lines": stats.get("training_lines", 0),
        "segmented_lines": stats.get("segmented_lines", 0),
        "label_source": label_source,
        "transcript_type": transcript_validation.transcript_type,
        "transcript_reasons": transcript_validation.reasons,
        "vision_provider": vision_provider,
    }
    if validated < MIN_VALIDATED_LINES:
        return {**base, "status": "rejected", "reason": "too_few_validated_lines"}
    if match_ratio < MIN_MATCH_RATIO:
        return {**base, "status": "rejected", "reason": "match_ratio_below_threshold"}
    return {**base, "status": "accepted"}


def write_classified_pagexml(
    *,
    output_path: Path,
    image_path: Path,
    image_width: int,
    image_height: int,
    classified: list[ClassifiedLine],
    pagexml_root: Path,
) -> str:
    write_pagexml(
        output_path=output_path,
        image_path=image_path,
        image_width=image_width,
        image_height=image_height,
        classified_lines=sorted(classified, key=lambda line: (line.segment.center_y, line.segment.center_x)),
        pagexml_root=pagexml_root,
    )
    return str(output_path).replace("\\", "/")
