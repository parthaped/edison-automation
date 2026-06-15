#!/usr/bin/env python3
"""Tests for corpus_discovery."""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIR))

from corpus_discovery import discover_documents  # noqa: E402


class CorpusDiscoveryTests(unittest.TestCase):
    def test_discovers_images_and_transcript(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            folder = root / "Letter 1"
            folder.mkdir()
            (folder / "Letter 1.jpg").write_text("fake", encoding="utf-8")
            (folder / "Letter 1 - Transcript.txt").write_text("Dear Sir:", encoding="utf-8")

            bundles = discover_documents(root)
            self.assertEqual(len(bundles), 1)
            self.assertEqual(bundles[0].name, "Letter 1")
            self.assertEqual(len(bundles[0].pages), 1)
            self.assertEqual(bundles[0].pages[0].page_name, "Letter 1.jpg")


if __name__ == "__main__":
    unittest.main()
