#!/usr/bin/env python3
"""Classify Scripto page transcriptions as diplomatic, summary, or ambiguous."""

from __future__ import annotations

import re
from dataclasses import dataclass

from kraken_gt.scripto import parse_scripto_transcription, training_lines

SUMMARY_BRACKET_RE = re.compile(
    r"\[(?:charts?|abstract|summary|editor'?s?\s+notes?|description)\s*:",
    re.IGNORECASE,
)
SUMMARY_PHRASE_RE = re.compile(
    r"\b(?:reports?\s+that|discusses|regarding\s+the|this\s+(?:letter|document|memorandum|report)|net\s+total)\b",
    re.IGNORECASE,
)

TranscriptType = str  # diplomatic | summary | ambiguous


@dataclass
class TranscriptValidation:
    transcript_type: TranscriptType
    reasons: list[str]
    training_line_count: int
    segmented_line_count: int
    line_segment_ratio: float
    total_chars: int


def classify_transcript(
    transcription: str,
    *,
    segmented_lines: int = 0,
    match_ratio: float | None = None,
) -> TranscriptValidation:
    """Heuristically classify a Scripto page transcription."""
    parsed = parse_scripto_transcription(transcription)
    references = training_lines(parsed)
    training_count = len(references)
    total_chars = len(transcription.strip())
    ratio = training_count / segmented_lines if segmented_lines > 0 else 1.0

    reasons: list[str] = []
    summary_score = 0

    if SUMMARY_BRACKET_RE.search(transcription):
        summary_score += 2
        reasons.append("bracketed_summary_block")

    for line in references:
        if SUMMARY_PHRASE_RE.search(line.text):
            summary_score += 1
            reasons.append("summary_phrasing")
            break

    if segmented_lines >= 12 and training_count <= 2:
        summary_score += 2
        reasons.append("few_scripto_lines_many_segments")

    if segmented_lines > 0 and ratio < 0.20:
        summary_score += 2
        reasons.append("low_line_segment_ratio")

    if total_chars < 80 and segmented_lines >= 8:
        summary_score += 1
        reasons.append("very_short_scripto")

    if training_count >= 4 and match_ratio is not None and match_ratio >= 0.60:
        return TranscriptValidation(
            transcript_type="diplomatic",
            reasons=["diplomatic_indicators"],
            training_line_count=training_count,
            segmented_line_count=segmented_lines,
            line_segment_ratio=ratio,
            total_chars=total_chars,
        )

    if summary_score >= 2:
        return TranscriptValidation(
            transcript_type="summary",
            reasons=sorted(set(reasons)),
            training_line_count=training_count,
            segmented_line_count=segmented_lines,
            line_segment_ratio=ratio,
            total_chars=total_chars,
        )

    if training_count >= 4:
        return TranscriptValidation(
            transcript_type="diplomatic",
            reasons=["multi_line_structure"],
            training_line_count=training_count,
            segmented_line_count=segmented_lines,
            line_segment_ratio=ratio,
            total_chars=total_chars,
        )

    return TranscriptValidation(
        transcript_type="ambiguous",
        reasons=sorted(set(reasons)) or ["insufficient_signal"],
        training_line_count=training_count,
        segmented_line_count=segmented_lines,
        line_segment_ratio=ratio,
        total_chars=total_chars,
    )


def is_iiif_summary_source(transcript_source: str) -> bool:
    """True when IIIF metadata is a document-level summary, not page diplomatic text."""
    source = transcript_source.lower()
    if not source.startswith("iiif:"):
        return False
    label = source.split(":", 1)[-1].strip()
    return label in {"abstract", "description", "editor's notes", "editors notes"}
