#!/usr/bin/env python3
"""Normalize transcription text for diplomatic accuracy comparison."""

from __future__ import annotations

import argparse
import re
import unicodedata


def format_for_compare(text: str, *, collapse_internal_spaces: bool = False) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    normalized = unicodedata.normalize("NFKC", normalized)
    lines = [line.rstrip() for line in normalized.split("\n")]
    normalized = "\n".join(lines)
    normalized = re.sub(r"\n{3,}", "\n\n", normalized)
    if collapse_internal_spaces:
        normalized = re.sub(r"[ \t]+", " ", normalized)
    return normalized.strip()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?", help="Input file (default: stdin).")
    parser.add_argument(
        "--collapse-internal-spaces",
        action="store_true",
        help="Collapse runs of spaces/tabs within lines.",
    )
    args = parser.parse_args()
    if args.input:
        from pathlib import Path

        raw = Path(args.input).read_text(encoding="utf-8")
    else:
        import sys

        raw = sys.stdin.read()
    print(format_for_compare(raw, collapse_internal_spaces=args.collapse_internal_spaces))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
