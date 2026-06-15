#!/usr/bin/env python3
"""Tests for compare_texts."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from compare_texts import compare_texts  # noqa: E402


class CompareTextsTests(unittest.TestCase):
    def test_identical_strings(self) -> None:
        report = compare_texts("Hello.", "Hello.")
        self.assertEqual(report.character_accuracy, 100.0)
        self.assertEqual(report.punctuation.accuracy, 100.0)

    def test_punctuation_mismatch(self) -> None:
        report = compare_texts("Hello.", "Hello,")
        self.assertLess(report.punctuation.accuracy, 100.0)

    def test_capitalization_mismatch(self) -> None:
        report = compare_texts("Hello", "hello")
        self.assertLess(report.capitalization.accuracy, 100.0)
        self.assertLess(report.character_accuracy, 100.0)

    def test_whitespace_paragraphs(self) -> None:
        report = compare_texts("A\n\nB", "A\nB")
        self.assertLess(report.whitespace.accuracy, 100.0)


if __name__ == "__main__":
    unittest.main()
