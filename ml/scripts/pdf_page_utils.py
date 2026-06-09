#!/usr/bin/env python3
"""PDF/image rasterization helpers shared by ML evaluation scripts."""

from __future__ import annotations

from pathlib import Path

from PIL import Image


def rasterize_pdf(pdf_path: Path, dpi: int = 300) -> list[tuple[int, Image.Image]]:
    try:
        import fitz
    except ImportError as error:
        raise RuntimeError("Install pymupdf to rasterize PDF inputs.") from error

    doc = fitz.open(pdf_path)
    zoom = dpi / 72.0
    matrix = fitz.Matrix(zoom, zoom)
    pages: list[tuple[int, Image.Image]] = []
    for page_index, page in enumerate(doc):
        pix = page.get_pixmap(matrix=matrix, alpha=False)
        pages.append((page_index, Image.frombytes("RGB", [pix.width, pix.height], pix.samples)))
    return pages


def load_page_images(input_path: Path, dpi: int = 300) -> list[tuple[str, Image.Image]]:
    suffix = input_path.suffix.lower()
    if suffix == ".pdf":
        return [(f"page_{index + 1:04d}", image) for index, image in rasterize_pdf(input_path, dpi=dpi)]
    if suffix in {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}:
        return [(input_path.stem, Image.open(input_path).convert("RGB"))]
    raise RuntimeError(f"Unsupported input type: {input_path}")
