#!/usr/bin/env python3
"""Tests for corpus_discovery against the committed benchmark corpus."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from corpus_discovery import discover_documents  # noqa: E402
from scratch_paths import repo_corpus_dir  # noqa: E402


class CorpusDiscoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.corpus_dir = repo_corpus_dir()
        if not cls.corpus_dir.is_dir():
            raise unittest.SkipTest(f"Committed corpus missing: {cls.corpus_dir}")

    def test_discovers_all_four_documents(self) -> None:
        bundles = discover_documents(self.corpus_dir)
        names = {bundle.name for bundle in bundles}
        self.assertEqual(
            names,
            {"Document 1", "Letter 1", "Letter 2", "Letter 3"},
        )

    def test_page_counts(self) -> None:
        bundles = {b.name: b for b in discover_documents(self.corpus_dir)}
        self.assertEqual(len(bundles["Document 1"].pages), 2)
        self.assertEqual(len(bundles["Letter 1"].pages), 1)
        self.assertEqual(bundles["Letter 1"].pages[0].page_name, "Letter 1.jpg")
        self.assertIn("transcript", bundles["Letter 3"].reference_path.name.lower())

    def test_total_page_jobs(self) -> None:
        bundles = discover_documents(self.corpus_dir)
        total_pages = sum(len(bundle.pages) for bundle in bundles)
        self.assertEqual(total_pages, 5)


if __name__ == "__main__":
    unittest.main()
