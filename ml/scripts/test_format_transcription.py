#!/usr/bin/env python3
"""Tests for format_transcription."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from format_transcription import format_for_compare  # noqa: E402


class FormatTranscriptionTests(unittest.TestCase):
    def test_preserves_paragraph_breaks(self) -> None:
        raw = "Line one.\r\n\r\nLine two.\r\n"
        formatted = format_for_compare(raw)
        self.assertIn("\n\n", formatted)
        self.assertEqual(formatted, "Line one.\n\nLine two.")

    def test_trims_trailing_spaces_per_line(self) -> None:
        raw = "Hello   \nWorld  "
        self.assertEqual(format_for_compare(raw), "Hello\nWorld")

    def test_does_not_lower_case(self) -> None:
        raw = "Dear Sir;"
        self.assertEqual(format_for_compare(raw), "Dear Sir;")


if __name__ == "__main__":
    unittest.main()
