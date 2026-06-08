#!/usr/bin/env python3
"""OCR-assisted ground-truth refinement for pages rejected by Scripto alignment."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from kraken_gt.kraken_align import KrakenRuntime
from kraken_gt.line_match import SegmentedLine, sequence_align_lines, match_statistics
from kraken_gt.pagexml import write_pagexml
from kraken_gt.regions import ClassifiedLine, classify_matched_line
from kraken_gt.scripto import parse_scripto_transcription, training_lines


@dataclass
class OcrRefineConfig:
    min_match_ratio: float = 0.45
    max_median_cer: float = 0.55
    max_pair_cer: float = 0.75
    ocr_only_cer_threshold: float = 0.55
    min_lines: int = 3
    min_ocr_line_chars: int = 4


def _ocr_assist_label(reference: str, ocr_text: str, threshold: float) -> tuple[str, list[str]]:
    """Pick Scripto when it agrees with OCR; otherwise fall back to OCR."""
    from evaluate_predictions import cer

    if not ocr_text.strip():
        return reference, []
    if not reference.strip():
        return ocr_text.strip(), ["ocr_assist"]
    score = cer(reference, ocr_text)
    if score <= threshold:
        return reference, []
    if len(ocr_text.strip()) >= 4:
        return ocr_text.strip(), ["ocr_assist"]
    return reference, ["low_confidence"]


def process_page_ocr_assisted(
    *,
    image_path: Path,
    transcription: str,
    output_path: Path,
    pagexml_root: Path,
    runtime: KrakenRuntime,
    config: OcrRefineConfig,
) -> dict[str, object]:
    """Build PAGE XML using Scripto + current-model OCR agreement."""
    parsed = parse_scripto_transcription(transcription)
    references = training_lines(parsed)
    reference_texts = [line.text for line in references]

    segmented, image_size = runtime.segmented_lines_with_ocr(image_path)
    matches = sequence_align_lines(
        reference_texts,
        segmented,
        max_pair_cer=config.max_pair_cer,
        gap_penalty=0.45,
    )

    used_segments: set[int] = set()
    classified: list[ClassifiedLine] = []
    ocr_assist_count = 0

    parsed_by_index = {idx: line for idx, line in enumerate(references)}
    for match in matches:
        parsed_line = parsed_by_index.get(match.scripto_index)
        if parsed_line is None:
            continue
        segment = segmented[match.segment_index]
        label, flags = _ocr_assist_label(
            match.reference_text,
            segment.ocr_text,
            config.ocr_only_cer_threshold,
        )
        if "low_confidence" in flags:
            continue
        if "ocr_assist" in flags:
            ocr_assist_count += 1
        used_segments.add(segment.index)
        line = classify_matched_line(
            reference_text=label,
            segment=segment,
            parsed=parsed_line,
            page_width=image_size[0],
            page_height=image_size[1],
            match_cer=match.match_cer,
            scripto_index=match.scripto_index,
        )
        merged_flags = sorted(set(line.quality_flags + flags))
        classified.append(
            ClassifiedLine(
                reference_text=label,
                segment=segment,
                region_type=line.region_type,
                quality_flags=merged_flags,
                scripto_index=match.scripto_index,
                match_cer=match.match_cer,
            )
        )

    # Unmatched segments: pure OCR self-labels when Scripto alignment failed badly.
    for segment in segmented:
        if segment.index in used_segments:
            continue
        ocr_text = segment.ocr_text.strip()
        if len(ocr_text) < config.min_ocr_line_chars:
            continue
        classified.append(
            ClassifiedLine(
                reference_text=ocr_text,
                segment=segment,
                region_type="body",
                quality_flags=["ocr_self_train"],
                scripto_index=-1,
                match_cer=1.0,
            )
        )
        ocr_assist_count += 1

    stats = match_statistics(len(reference_texts), len(segmented), matches)
    if reference_texts:
        stats["match_ratio"] = len([line for line in classified if "ocr_self_train" not in line.quality_flags]) / len(
            reference_texts
        )
    stats["validated_lines"] = len(classified)
    stats["ocr_assist_lines"] = ocr_assist_count

    if len(classified) < config.min_lines:
        return {
            "status": "rejected",
            "reason": "ocr_refine_too_few_lines",
            **stats,
        }

    if stats.get("median_match_cer", 1.0) > config.max_median_cer and ocr_assist_count == 0:
        return {
            "status": "rejected",
            "reason": "ocr_refine_median_cer",
            **stats,
        }

    if stats.get("match_ratio", 0.0) < config.min_match_ratio and ocr_assist_count < config.min_lines:
        return {
            "status": "rejected",
            "reason": "ocr_refine_match_ratio",
            **stats,
        }

    write_pagexml(
        output_path=output_path,
        image_path=image_path,
        image_width=image_size[0],
        image_height=image_size[1],
        classified_lines=sorted(classified, key=lambda line: (line.segment.center_y, line.segment.center_x)),
        pagexml_root=pagexml_root,
    )
    return {
        "status": "accepted",
        "source": "ocr_assisted",
        "pagexml_path": str(output_path).replace("\\", "/"),
        **stats,
    }
