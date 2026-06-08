#!/usr/bin/env python3
"""Parse Scripto transcriptions from Edison Digital."""

from __future__ import annotations

import html
import re
from dataclasses import dataclass, field


MARGINALIA_PREFIX_RE = re.compile(
    r"^\[(?:TAE|Edison|TAE's)\s+Marginalia\]\s*",
    re.IGNORECASE,
)
TAG_RE = re.compile(r"<([a-zA-Z][a-zA-Z0-9_-]*)>")
UNCERTAIN_BRACKET_RE = re.compile(r"\[[^\]]*\?\]")
DAMAGE_RE = re.compile(r"\[DAMAGE\]", re.IGNORECASE)
UNCERTAIN_TOKEN_RE = re.compile(r"\[\?\]")


@dataclass
class ParsedLine:
    text: str
    raw_text: str
    region_hint: str = "body"
    quality_flags: list[str] = field(default_factory=list)
    exclude_from_training: bool = False
    line_index: int = 0


def normalize_dashes(text: str) -> str:
    return (
        text.replace("\u2014", "—")
        .replace("\u2013", "–")
        .replace("\u00a0", " ")
    )


def detect_region_hint(raw_line: str, cleaned: str) -> tuple[str, list[str]]:
    flags: list[str] = []
    hint = "body"
    lower = cleaned.lower()

    if MARGINALIA_PREFIX_RE.match(raw_line):
        hint = "marginal"
        flags.append("marginal")
    elif TAG_RE.search(raw_line):
        tag = TAG_RE.search(raw_line)
        tag_name = (tag.group(1) if tag else "").lower()
        if tag_name == "diagram":
            hint = "figure"
            flags.append("figure")
        else:
            hint = "marginal"
            flags.append("marginal")
    elif lower.strip() == "personal":
        hint = "header"
        flags.append("printed")
    elif any(
        phrase in lower
        for phrase in ("yours truly", "yours very truly", "respectfully yours", "sincerely yours")
    ):
        hint = "signature"

    return hint, flags


def should_exclude_line(raw_line: str, cleaned: str) -> tuple[bool, list[str]]:
    flags: list[str] = []
    if not cleaned.strip():
        return True, ["empty"]
    if DAMAGE_RE.search(raw_line):
        return True, ["damaged"]
    if UNCERTAIN_BRACKET_RE.search(raw_line):
        return True, ["uncertain"]
    if UNCERTAIN_TOKEN_RE.search(raw_line):
        return True, ["uncertain"]
    if TAG_RE.fullmatch(raw_line.strip()) or cleaned.startswith("<") and cleaned.endswith(">"):
        return True, ["tag_only"]
    return False, flags


def clean_line_text(raw_line: str) -> str:
    text = normalize_dashes(html.unescape(raw_line.strip()))
    text = MARGINALIA_PREFIX_RE.sub("", text)
    text = TAG_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_scripto_transcription(transcription: str) -> list[ParsedLine]:
    lines: list[ParsedLine] = []
    for index, raw in enumerate(transcription.splitlines()):
        raw_line = raw.rstrip()
        if not raw_line.strip():
            continue
        cleaned = clean_line_text(raw_line)
        exclude, exclude_flags = should_exclude_line(raw_line, cleaned)
        region_hint, region_flags = detect_region_hint(raw_line, cleaned)
        flags = sorted(set(exclude_flags + region_flags))
        lines.append(
            ParsedLine(
                text=cleaned,
                raw_text=raw_line,
                region_hint=region_hint,
                quality_flags=flags,
                exclude_from_training=exclude,
                line_index=index,
            )
        )
    return lines


def training_lines(parsed: list[ParsedLine]) -> list[ParsedLine]:
    return [line for line in parsed if not line.exclude_from_training and line.text]
