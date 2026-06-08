#!/usr/bin/env python3
"""Unit tests for Kraken ground-truth helpers."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from kraken_gt.confidence_filter import (  # noqa: E402
    filter_trainable_lines,
    line_is_trainable,
    page_manifest_is_high_quality,
)
from kraken_gt.line_match import SegmentedLine, sequence_align_lines  # noqa: E402
from kraken_gt.regions import ClassifiedLine  # noqa: E402
from kraken_gt.scripto import parse_scripto_transcription, training_lines  # noqa: E402
from kraken_gt.transcript_validate import classify_transcript, is_iiif_summary_source  # noqa: E402
from rutgers_omeka import classify_split, sample_diverse_pages, TranscribedPage  # noqa: E402


class ScriptoParserTests(unittest.TestCase):
    def test_marginalia_marker(self) -> None:
        text = "[TAE Marginalia] Nov 9 '92 Say that first at present\nBody line"
        parsed = parse_scripto_transcription(text)
        self.assertEqual(len(parsed), 2)
        self.assertEqual(parsed[0].region_hint, "marginal")
        self.assertIn("Nov 9", parsed[0].text)
        self.assertEqual(parsed[1].region_hint, "body")

    def test_exclude_uncertain(self) -> None:
        text = "Good line\n[filament?]\n[DAMAGE]"
        parsed = training_lines(parse_scripto_transcription(text))
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0].text, "Good line")


class LineMatchTests(unittest.TestCase):
    def test_sequence_alignment(self) -> None:
        references = ["Dear Sir", "Yours truly"]
        segments = [
            SegmentedLine(0, "Dear Sir", [], [], (0, 0, 10, 5), 5, 2),
            SegmentedLine(1, "noise", [], [], (0, 6, 10, 11), 5, 8),
            SegmentedLine(2, "Yours truly", [], [], (0, 12, 10, 17), 5, 14),
        ]
        matches = sequence_align_lines(references, segments)
        self.assertGreaterEqual(len(matches), 2)
        self.assertEqual(matches[0].reference_text, "Dear Sir")
        self.assertEqual(matches[-1].reference_text, "Yours truly")


class TranscriptValidationTests(unittest.TestCase):
    def test_summary_chart_block(self) -> None:
        text = (
            "THE NORTH AMERICAN PHONOGRAPH CO.\n"
            "Report of Machines for Month of February 1892\n"
            "[Charts: rented Phonographs 4022 returned 132 net 3890]"
        )
        result = classify_transcript(text, segmented_lines=40)
        self.assertEqual(result.transcript_type, "summary")

    def test_diplomatic_letter(self) -> None:
        text = (
            "Oct. 11, 1892.\n"
            "Dear Mr. Bush,-\n"
            "The last agreement of the series given me the other day by yourself is dated April 1st, 1890.\n"
            "Yours very truly,\n"
            "Private Secretary."
        )
        result = classify_transcript(text, segmented_lines=10, match_ratio=0.85)
        self.assertEqual(result.transcript_type, "diplomatic")

    def test_iiif_abstract_excluded(self) -> None:
        self.assertTrue(is_iiif_summary_source("iiif:Abstract"))


class ConfidenceFilterTests(unittest.TestCase):
    def _line(self, text: str, cer: float, flags: list[str] | None = None) -> ClassifiedLine:
        segment = SegmentedLine(0, text, [], [], (0, 0, 10, 5), 5, 2)
        return ClassifiedLine(
            reference_text=text,
            segment=segment,
            region_type="body",
            quality_flags=flags or [],
            scripto_index=0,
            match_cer=cer,
        )

    def test_line_blocks_uncertain(self) -> None:
        self.assertFalse(line_is_trainable(self._line("noise", 0.1, ["uncertain"])))

    def test_filter_keeps_high_confidence(self) -> None:
        lines = [
            self._line("Dear Sir", 0.05),
            self._line("Body text here", 0.12),
            self._line("Yours truly", 0.08),
        ]
        kept, confidence = filter_trainable_lines(lines, max_line_cer=0.28, min_lines=3)
        self.assertTrue(confidence.accepted)
        self.assertEqual(len(kept), 3)

    def test_page_manifest_skews_segmentation(self) -> None:
        row = {
            "status": "accepted",
            "match_ratio": 0.8,
            "mean_match_cer": 0.2,
            "training_lines": 5,
            "segmented_lines": 20,
        }
        ok, reason = page_manifest_is_high_quality(row)
        self.assertFalse(ok)
        self.assertEqual(reason, "segmentation_skew")


class OmekaSamplingTests(unittest.TestCase):
    def test_diverse_sampling(self) -> None:
        pages = [
            TranscribedPage(
                media_id=i,
                document_id=f"D{i % 3}AAA",
                page_stem=f"p{i}",
                filename=f"D{i % 3}AAA/p{i}.jpg",
                image_url=f"https://example/{i}.jpg",
                transcription="line",
                width=100,
                height=100,
                split_bucket=f"D{i % 3}",
            )
            for i in range(12)
        ]
        sampled = sample_diverse_pages(pages, limit=6, seed=1)
        self.assertEqual(len(sampled), 6)
        buckets = {page.split_bucket for page in sampled}
        self.assertGreaterEqual(len(buckets), 2)

    def test_split_is_stable(self) -> None:
        self.assertEqual(classify_split("CL207AAA"), classify_split("CL207AAA"))


if __name__ == "__main__":
    unittest.main()
