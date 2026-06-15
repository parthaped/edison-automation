#!/usr/bin/env python3
"""Discover benchmark corpus folders, images, and reference transcripts."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}


@dataclass(frozen=True)
class PageJob:
    document: str
    page_name: str
    image_path: Path
    page_index: int


@dataclass(frozen=True)
class DocumentBundle:
    name: str
    folder: Path
    reference_path: Path
    pages: tuple[PageJob, ...]


def _natural_key(text: str) -> list[int | str]:
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", text)]


def find_reference_transcript(folder: Path) -> Path | None:
    matches = [
        path
        for path in folder.iterdir()
        if path.is_file() and path.suffix.lower() == ".txt" and "transcript" in path.name.lower()
    ]
    if not matches:
        return None
    return sorted(matches, key=lambda p: _natural_key(p.name))[0]


def discover_documents(data_dir: Path) -> list[DocumentBundle]:
    if not data_dir.is_dir():
        raise RuntimeError(f"Data directory not found: {data_dir}")

    bundles: list[DocumentBundle] = []
    for folder in sorted(data_dir.iterdir(), key=lambda p: _natural_key(p.name)):
        if not folder.is_dir():
            continue
        reference = find_reference_transcript(folder)
        if reference is None:
            continue
        images = sorted(
            [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() in IMAGE_SUFFIXES],
            key=lambda p: _natural_key(p.name),
        )
        if not images:
            continue
        pages = tuple(
            PageJob(
                document=folder.name,
                page_name=image.name,
                image_path=image,
                page_index=index,
            )
            for index, image in enumerate(images, start=1)
        )
        bundles.append(
            DocumentBundle(
                name=folder.name,
                folder=folder,
                reference_path=reference,
                pages=pages,
            )
        )
    return bundles
