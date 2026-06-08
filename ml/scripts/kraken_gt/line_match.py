#!/usr/bin/env python3
"""Line matching between Scripto reference lines and Kraken segmented lines."""

from __future__ import annotations

from dataclasses import dataclass

from evaluate_predictions import cer


@dataclass
class SegmentedLine:
    index: int
    ocr_text: str
    baseline: list[tuple[int, int]]
    boundary: list[tuple[int, int]]
    bbox: tuple[int, int, int, int]
    center_y: float
    center_x: float


@dataclass
class LineMatch:
    scripto_index: int
    segment_index: int
    reference_text: str
    ocr_text: str
    match_cer: float


def bbox_from_points(points: list[tuple[int, int]]) -> tuple[int, int, int, int]:
    xs = [point[0] for point in points]
    ys = [point[1] for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def sequence_align_lines(
    references: list[str],
    segments: list[SegmentedLine],
    gap_penalty: float = 0.55,
    max_pair_cer: float = 0.85,
) -> list[LineMatch]:
    """Needleman-Wunsch alignment using OCR-vs-reference CER as match cost."""
    if not references or not segments:
        return []

    n = len(references)
    m = len(segments)
    cost: list[list[float]] = [[0.0] * (m + 1) for _ in range(n + 1)]
    backtrack: list[list[str | None]] = [[None] * (m + 1) for _ in range(n + 1)]

    for i in range(1, n + 1):
        cost[i][0] = cost[i - 1][0] + gap_penalty
        backtrack[i][0] = "up"
    for j in range(1, m + 1):
        cost[0][j] = cost[0][j - 1] + gap_penalty
        backtrack[0][j] = "left"

    pair_cost: list[list[float]] = [[0.0] * m for _ in range(n)]
    for i, reference in enumerate(references):
        for j, segment in enumerate(segments):
            pair_cost[i][j] = cer(reference, segment.ocr_text)

    for i in range(1, n + 1):
        for j in range(1, m + 1):
            match = cost[i - 1][j - 1] + pair_cost[i - 1][j - 1]
            delete = cost[i - 1][j] + gap_penalty
            insert = cost[i][j - 1] + gap_penalty
            best = min(match, delete, insert)
            cost[i][j] = best
            if best == match:
                backtrack[i][j] = "diag"
            elif best == delete:
                backtrack[i][j] = "up"
            else:
                backtrack[i][j] = "left"

    matches: list[LineMatch] = []
    i, j = n, m
    while i > 0 or j > 0:
        direction = backtrack[i][j]
        if direction == "diag" and i > 0 and j > 0:
            ref = references[i - 1]
            seg = segments[j - 1]
            pair = pair_cost[i - 1][j - 1]
            if pair <= max_pair_cer:
                matches.append(
                    LineMatch(
                        scripto_index=i - 1,
                        segment_index=j - 1,
                        reference_text=ref,
                        ocr_text=seg.ocr_text,
                        match_cer=pair,
                    )
                )
            i -= 1
            j -= 1
        elif direction == "up" and i > 0:
            i -= 1
        elif direction == "left" and j > 0:
            j -= 1
        else:
            break

    matches.reverse()
    return matches


def match_statistics(
    reference_count: int,
    segment_count: int,
    matches: list[LineMatch],
) -> dict[str, float]:
    if not matches:
        return {
            "matched_lines": 0,
            "match_ratio": 0.0,
            "mean_match_cer": 1.0,
            "median_match_cer": 1.0,
        }
    cers = sorted(match.match_cer for match in matches)
    mid = len(cers) // 2
    median = cers[mid] if len(cers) % 2 else (cers[mid - 1] + cers[mid]) / 2
    reference_count = max(reference_count, 1)
    return {
        "matched_lines": len(matches),
        "match_ratio": len(matches) / reference_count,
        "mean_match_cer": sum(cers) / len(cers),
        "median_match_cer": median,
    }
