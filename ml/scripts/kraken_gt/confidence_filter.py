#!/usr/bin/env python3
"""Line- and page-level confidence gates for high-quality Kraken training."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from kraken_gt.regions import ClassifiedLine

DEFAULT_MAX_LINE_CER = 0.28
DEFAULT_MAX_MEAN_CER = 0.30
DEFAULT_MIN_MATCH_RATIO = 0.72
DEFAULT_MAX_SEGMENT_RATIO = 2.2
BLOCKED_FLAGS = frozenset({"ocr_self_train", "low_confidence", "uncertain"})


@dataclass
class PageConfidence:
    accepted: bool
    reason: str
    kept_lines: int
    dropped_lines: int
    mean_kept_cer: float


def line_is_trainable(
    line: ClassifiedLine,
    *,
    max_line_cer: float = DEFAULT_MAX_LINE_CER,
    blocked_flags: frozenset[str] = BLOCKED_FLAGS,
) -> bool:
    if not line.reference_text.strip():
        return False
    if line.match_cer > max_line_cer:
        return False
    if blocked_flags.intersection(line.quality_flags):
        return False
    return True


def filter_trainable_lines(
    classified: list[ClassifiedLine],
    *,
    max_line_cer: float = DEFAULT_MAX_LINE_CER,
    min_lines: int = 3,
) -> tuple[list[ClassifiedLine], PageConfidence]:
    kept = [line for line in classified if line_is_trainable(line, max_line_cer=max_line_cer)]
    dropped = len(classified) - len(kept)
    if len(kept) < min_lines:
        return kept, PageConfidence(
            accepted=False,
            reason="too_few_confident_lines",
            kept_lines=len(kept),
            dropped_lines=dropped,
            mean_kept_cer=1.0,
        )
    mean_cer = sum(line.match_cer for line in kept) / len(kept)
    return kept, PageConfidence(
        accepted=True,
        reason="ok",
        kept_lines=len(kept),
        dropped_lines=dropped,
        mean_kept_cer=mean_cer,
    )


def page_manifest_is_high_quality(
    row: dict[str, Any],
    *,
    min_match_ratio: float = DEFAULT_MIN_MATCH_RATIO,
    max_mean_cer: float = DEFAULT_MAX_MEAN_CER,
    max_segment_ratio: float = DEFAULT_MAX_SEGMENT_RATIO,
) -> tuple[bool, str]:
    if row.get("status") != "accepted":
        return False, "not_accepted"
    if "label_conflict" in (row.get("quality_flags") or []):
        return False, "label_conflict"
    if str(row.get("transcript_type", "")) == "summary" and row.get("label_source") == "scripto":
        return False, "scripto_summary"

    ratio = float(row.get("match_ratio") or 0.0)
    mean_cer = float(row.get("mean_match_cer") or 1.0)
    training = max(int(row.get("training_lines") or 0), 1)
    segmented = int(row.get("segmented_lines") or 0)
    seg_ratio = segmented / training

    if ratio < min_match_ratio:
        return False, "low_match_ratio"
    if mean_cer > max_mean_cer:
        return False, "high_mean_cer"
    if seg_ratio > max_segment_ratio:
        return False, "segmentation_skew"
    return True, "ok"
