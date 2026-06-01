#!/usr/bin/env python3
"""Combine harvested Edison inventory with local human transcripts."""

from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path


SOURCE_FIELDS = [
    "document_id",
    "folder_id",
    "source_path",
    "source_mime",
    "page_count",
    "transcript_path",
    "transcript_granularity",
    "document_type",
    "text_mode",
    "layout_type",
    "writer_group",
    "split",
    "quality_notes",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--documents",
        type=Path,
        default=Path("ml/data/manifests/documents.csv"),
        help="Document inventory CSV from harvest_iiif.py.",
    )
    parser.add_argument(
        "--transcripts",
        type=Path,
        default=Path("ml/data/transcripts"),
        help="Directory containing human transcripts named by document ID.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("ml/data/manifests/source_manifest.csv"),
        help="Output source manifest CSV.",
    )
    return parser.parse_args()


def transcript_for(document_id: str, transcripts_dir: Path) -> Path | None:
    for extension in (".txt", ".md", ".json", ".jsonl", ".xml"):
        candidate = transcripts_dir / f"{document_id}{extension}"
        if candidate.exists():
            return candidate
    matches = sorted(transcripts_dir.glob(f"{document_id}.*"))
    return matches[0] if matches else None


def infer_granularity(path: Path | None) -> str:
    if path is None:
        return "missing"
    name = path.name.lower()
    if "line" in name:
        return "line"
    if "page" in name:
        return "page"
    if path.suffix.lower() == ".xml":
        return "region"
    return "document"


def infer_text_mode(document_type: str, title: str) -> str:
    haystack = f"{document_type} {title}".lower()
    if any(token in haystack for token in ("printed", "pamphlet", "newspaper")):
        return "printed"
    if any(token in haystack for token in ("typed", "typescript")):
        return "typed"
    if any(token in haystack for token in ("letter", "note", "notebook", "memorandum")):
        return "handwritten"
    return "mixed"


def infer_layout(document_type: str, title: str) -> str:
    haystack = f"{document_type} {title}".lower()
    if any(token in haystack for token in ("ledger", "account", "statement")):
        return "ledger"
    if any(token in haystack for token in ("notebook", "note", "drawing")):
        return "notebook"
    if any(token in haystack for token in ("form", "application")):
        return "form"
    return "single_column"


def infer_writer(authors: str) -> str:
    if not authors.strip():
        return "unknown"
    first = re.split(r";|,", authors)[0].strip()
    return first or "unknown"


def read_documents(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as handle:
        return list(csv.DictReader(handle))


def build_row(document: dict[str, str], transcripts_dir: Path) -> dict[str, str]:
    document_id = document["document_id"]
    transcript_path = transcript_for(document_id, transcripts_dir)
    transcript_status = "available" if transcript_path else "missing"
    source_path = document.get("local_image_dir", "")
    return {
        "document_id": document_id,
        "folder_id": document.get("folder_id", ""),
        "source_path": source_path,
        "source_mime": "image/jpeg",
        "page_count": document.get("page_count", "0"),
        "transcript_path": str(transcript_path).replace("\\", "/") if transcript_path else "",
        "transcript_granularity": infer_granularity(transcript_path),
        "document_type": document.get("document_type", ""),
        "text_mode": infer_text_mode(document.get("document_type", ""), document.get("title", "")),
        "layout_type": infer_layout(document.get("document_type", ""), document.get("title", "")),
        "writer_group": infer_writer(document.get("authors", "")),
        "split": document.get("split", "train"),
        "quality_notes": transcript_status,
    }


def main() -> int:
    args = parse_args()
    documents = read_documents(args.documents)
    rows = [build_row(document, args.transcripts) for document in documents]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=SOURCE_FIELDS)
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} source rows to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
