#!/usr/bin/env python3
"""Character-level transcription accuracy comparison."""

from __future__ import annotations

import argparse
import json
import string
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from pathlib import Path

PUNCTUATION = set(string.punctuation)


@dataclass
class CharOp:
    ref: str | None
    hyp: str | None
    op: str


@dataclass
class CategoryStats:
    total: int = 0
    correct: int = 0

    @property
    def accuracy(self) -> float:
        return (self.correct / self.total * 100.0) if self.total else 100.0


@dataclass
class CompareReport:
    reference_length: int
    hypothesis_length: int
    matches: int
    substitutions: int
    insertions: int
    deletions: int
    character_accuracy: float
    character_error_rate: float
    letters: CategoryStats
    punctuation: CategoryStats
    capitalization: CategoryStats
    whitespace: CategoryStats


def classify_char(ch: str) -> str:
    if ch.isspace():
        return "whitespace"
    if ch in PUNCTUATION:
        return "punctuation"
    if ch.isalpha():
        return "letters"
    return "other"


def align_characters(ref: str, hyp: str) -> list[CharOp]:
    matcher = SequenceMatcher(a=ref, b=hyp, autojunk=False)
    ops: list[CharOp] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for offset in range(i2 - i1):
                ops.append(CharOp(ref[i1 + offset], hyp[j1 + offset], "match"))
        elif tag == "replace":
            ref_chunk = ref[i1:i2]
            hyp_chunk = hyp[j1:j2]
            max_len = max(len(ref_chunk), len(hyp_chunk))
            for offset in range(max_len):
                r = ref_chunk[offset] if offset < len(ref_chunk) else None
                h = hyp_chunk[offset] if offset < len(hyp_chunk) else None
                if r is not None and h is not None:
                    ops.append(CharOp(r, h, "replace"))
                elif r is not None:
                    ops.append(CharOp(r, None, "delete"))
                else:
                    ops.append(CharOp(None, h, "insert"))
        elif tag == "delete":
            for r in ref[i1:i2]:
                ops.append(CharOp(r, None, "delete"))
        elif tag == "insert":
            for h in hyp[j1:j2]:
                ops.append(CharOp(None, h, "insert"))

    return ops


def compare_texts(ref: str, hyp: str) -> CompareReport:
    ops = align_characters(ref, hyp)
    matches = substitutions = insertions = deletions = 0
    letters = CategoryStats()
    punctuation = CategoryStats()
    capitalization = CategoryStats()
    whitespace = CategoryStats()
    buckets = {
        "letters": letters,
        "punctuation": punctuation,
        "whitespace": whitespace,
    }

    ref_len = sum(1 for op in ops if op.ref is not None)

    for op in ops:
        if op.op == "match":
            matches += 1
        elif op.op == "replace":
            substitutions += 1
        elif op.op == "delete":
            deletions += 1
        elif op.op == "insert":
            insertions += 1

        if op.ref is None:
            continue

        ref_ch = op.ref
        hyp_ch = op.hyp
        bucket = buckets.get(classify_char(ref_ch))
        if bucket is not None:
            bucket.total += 1
            if op.op == "match":
                bucket.correct += 1

        if ref_ch.isalpha():
            capitalization.total += 1
            if hyp_ch is not None and ref_ch == hyp_ch:
                capitalization.correct += 1

    errors = substitutions + insertions + deletions
    cer = (errors / ref_len * 100.0) if ref_len else 0.0
    accuracy = 100.0 - cer

    return CompareReport(
        reference_length=ref_len,
        hypothesis_length=sum(1 for op in ops if op.hyp is not None),
        matches=matches,
        substitutions=substitutions,
        insertions=insertions,
        deletions=deletions,
        character_accuracy=accuracy,
        character_error_rate=cer,
        letters=letters,
        punctuation=punctuation,
        capitalization=capitalization,
        whitespace=whitespace,
    )


def report_to_dict(report: CompareReport) -> dict[str, object]:
    return {
        "reference_length": report.reference_length,
        "hypothesis_length": report.hypothesis_length,
        "matches": report.matches,
        "substitutions": report.substitutions,
        "insertions": report.insertions,
        "deletions": report.deletions,
        "character_accuracy": round(report.character_accuracy, 4),
        "character_error_rate": round(report.character_error_rate, 4),
        "letters_accuracy": round(report.letters.accuracy, 4),
        "punctuation_accuracy": round(report.punctuation.accuracy, 4),
        "capitalization_accuracy": round(report.capitalization.accuracy, 4),
        "whitespace_accuracy": round(report.whitespace.accuracy, 4),
        "categories": {
            "letters": asdict(report.letters),
            "punctuation": asdict(report.punctuation),
            "capitalization": asdict(report.capitalization),
            "whitespace": asdict(report.whitespace),
        },
    }


def accuracy_summary(report: CompareReport) -> dict[str, float]:
    return {
        "character": round(report.character_accuracy, 4),
        "punctuation": round(report.punctuation.accuracy, 4),
        "capitalization": round(report.capitalization.accuracy, 4),
        "whitespace": round(report.whitespace.accuracy, 4),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ref-file", type=Path, required=True)
    parser.add_argument("--hyp-file", type=Path, required=True)
    parser.add_argument("--json-out", type=Path, default=None)
    args = parser.parse_args()

    ref = args.ref_file.read_text(encoding="utf-8")
    hyp = args.hyp_file.read_text(encoding="utf-8")
    report = compare_texts(ref, hyp)
    payload = report_to_dict(report)

    if args.json_out:
        args.json_out.parent.mkdir(parents=True, exist_ok=True)
        args.json_out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    else:
        print(json.dumps(payload, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
