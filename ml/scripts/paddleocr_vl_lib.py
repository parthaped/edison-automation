#!/usr/bin/env python3
"""Shared PaddleOCR-VL-1.6 runtime for CLI and Edison OCR workers."""

from __future__ import annotations

import os
from pathlib import Path

MODEL_LABEL = "local/paddleocr-vl-1.6"
PROMPT_VERSION = "paddleocr-vl-v1"
DEFAULT_PIPELINE_VERSION = "v1.6"


def configure_paddle_env() -> None:
    os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")


def markdown_from_result(result) -> str:
    payload = result.json if hasattr(result, "json") else None
    if isinstance(payload, dict):
        res = payload.get("res", payload)
        if isinstance(res, dict):
            markdown = res.get("markdown", {})
            if isinstance(markdown, dict):
                text = markdown.get("markdown_text") or markdown.get("text")
                if isinstance(text, str) and text.strip():
                    return text.strip()
            parsing = res.get("parsing_res_list")
            if isinstance(parsing, list):
                blocks = [
                    str(block.get("block_content", "")).strip()
                    for block in parsing
                    if isinstance(block, dict) and block.get("block_content")
                ]
                if blocks:
                    return "\n\n".join(blocks).strip()
    md_path = getattr(result, "markdown", None)
    if isinstance(md_path, Path) and md_path.exists():
        return md_path.read_text(encoding="utf-8").strip()
    if isinstance(md_path, str):
        path = Path(md_path)
        if path.exists():
            return path.read_text(encoding="utf-8").strip()
    return ""


class PaddleOcrVlRuntime:
    def __init__(
        self,
        *,
        pipeline_version: str = DEFAULT_PIPELINE_VERSION,
        device: str | None = None,
    ) -> None:
        configure_paddle_env()
        from paddleocr import PaddleOCRVL

        init_kwargs: dict[str, str] = {"pipeline_version": pipeline_version}
        if device:
            init_kwargs["device"] = device
        self.pipeline = PaddleOCRVL(**init_kwargs)
        self.pipeline_version = pipeline_version
        self.model_label = MODEL_LABEL

    def transcribe_image(self, image_path: Path) -> str:
        results = list(self.pipeline.predict(input=str(image_path)))
        if not results:
            return ""
        parts = [markdown_from_result(result) for result in results]
        parts = [part for part in parts if part]
        return "\n\n".join(parts).strip()

    def transcribe_pdf(self, pdf_path: Path, *, concatenate_pages: bool = False) -> list[str]:
        pages_res = list(self.pipeline.predict(input=str(pdf_path)))
        if not pages_res:
            return []
        results = pages_res
        if concatenate_pages and len(pages_res) > 1:
            results = self.pipeline.restructure_pages(pages_res, concatenate_pages=True)
        return [markdown_from_result(result) for result in results if markdown_from_result(result)]

    def transcribe_image_paths_as_pdf(self, image_paths: list[Path]) -> list[str]:
        from pdf_page_utils import assemble_images_to_pdf

        if not image_paths:
            return []
        if len(image_paths) == 1:
            return [self.transcribe_image(image_paths[0])]

        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as handle:
            temp_pdf = Path(handle.name)
        try:
            assemble_images_to_pdf(image_paths, temp_pdf)
            texts = self.transcribe_pdf(temp_pdf, concatenate_pages=False)
            if len(texts) >= len(image_paths):
                return texts[: len(image_paths)]
            padded = list(texts)
            padded.extend([""] * (len(image_paths) - len(texts)))
            return padded
        finally:
            temp_pdf.unlink(missing_ok=True)


def create_runtime(
    *,
    pipeline_version: str = DEFAULT_PIPELINE_VERSION,
    device: str | None = None,
) -> PaddleOcrVlRuntime:
    return PaddleOcrVlRuntime(pipeline_version=pipeline_version, device=device)
