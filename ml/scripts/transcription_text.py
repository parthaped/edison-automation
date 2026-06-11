#!/usr/bin/env python3
"""Shared text prompt and parsing helpers for local OCR workers."""

from __future__ import annotations

import re

DIPLOMATIC_PROMPT = """Transcribe this Edison archival document page using diplomatic transcription rules:
- Preserve original spelling, abbreviations, punctuation, and capitalization.
- Output one text line per visible line of writing, in reading order.
- Do not summarize; transcribe what is written on the page.
- Use plain text only (no markdown headings or section labels).
- If less than 70% confident of a word, bracket it with a trailing question mark.
- Output ONLY the transcription lines, nothing else."""

SECTION_LABEL_RE = re.compile(
    r"^(?:##\s+.+|(?:Letterhead|Dateline|To|From|Salutation|Body|Closing|Signature|Annotations)\s*:)\s*$",
    re.IGNORECASE,
)


def parse_transcription_lines(raw_text: str) -> list[str]:
    """Normalize vision OCR output into transcription lines."""
    lines: list[str] = []
    for raw in raw_text.splitlines():
        stripped = raw.strip()
        if not stripped:
            continue
        if SECTION_LABEL_RE.match(stripped):
            continue
        if stripped.startswith("##"):
            continue
        lines.append(stripped)
    return lines
