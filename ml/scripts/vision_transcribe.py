#!/usr/bin/env python3
"""Vision OCR transcription adapters (Google Gemini API + local Kraken/TrOCR)."""

from __future__ import annotations

import base64
import json
import mimetypes
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from abc import ABC, abstractmethod
from collections.abc import Callable
from pathlib import Path

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta"

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
    """Normalize vision-OCR output into training lines."""
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


def cache_path_for(page_id: str, provider: str, cache_dir: Path) -> Path:
    return cache_dir / f"{page_id}.{provider}.json"


def load_cached_lines(cache_file: Path) -> list[str] | None:
    if not cache_file.exists():
        return None
    data = json.loads(cache_file.read_text(encoding="utf-8"))
    lines = data.get("lines")
    if isinstance(lines, list) and lines:
        return [str(line) for line in lines]
    return None


def save_cached_lines(cache_file: Path, provider: str, page_id: str, lines: list[str], raw_text: str) -> None:
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "page_id": page_id,
        "provider": provider,
        "lines": lines,
        "raw_text": raw_text,
    }
    cache_file.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


class VisionTranscriber(ABC):
    name: str

    @abstractmethod
    def transcribe_page(self, image_path: Path) -> list[str]:
        raise NotImplementedError


def _build_gemini_payload(image_path: Path) -> dict[str, object]:
    mime, _ = mimetypes.guess_type(image_path.name)
    mime = mime or "image/jpeg"
    encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
    return {
        "contents": [
            {
                "parts": [
                    {"text": DIPLOMATIC_PROMPT},
                    {"inline_data": {"mime_type": mime, "data": encoded}},
                ]
            }
        ],
        "generationConfig": {"maxOutputTokens": 4096},
    }


def _parse_gemini_generate_content(body: dict[str, object]) -> list[str]:
    candidates = body.get("candidates") or []
    if not candidates:
        raise RuntimeError(f"Gemini API returned no candidates: {body}")
    content = candidates[0].get("content") or {}
    parts = content.get("parts") or []
    raw_parts = [
        str(part.get("text", "")).strip()
        for part in parts
        if isinstance(part, dict) and part.get("text")
    ]
    raw = "\n".join(raw_parts).strip()
    lines = parse_transcription_lines(raw)
    if not lines:
        raise RuntimeError("Gemini returned empty transcription")
    return lines


def _post_gemini_json(
    url: str,
    payload: dict[str, object],
    *,
    headers: dict[str, str],
    provider_label: str,
) -> dict[str, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    body: dict[str, object] | None = None
    last_http_error: urllib.error.HTTPError | None = None
    for attempt in range(8):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                body = json.loads(response.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as error:
            last_http_error = error
            if error.code not in {429, 502, 503} or attempt + 1 >= 8:
                detail = error.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"{provider_label} HTTP {error.code}: {detail}") from error
            wait = 15 * (attempt + 1) if error.code == 429 else 5 * (attempt + 1)
            time.sleep(wait)
    if body is None and last_http_error is not None:
        detail = last_http_error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{provider_label} HTTP {last_http_error.code}: {detail}") from last_http_error
    if body is None:
        raise RuntimeError(f"{provider_label} returned an empty response.")
    return body


class GeminiApiTranscriber(VisionTranscriber):
    name = "gemini"

    def __init__(
        self,
        *,
        api_key: str,
        model: str = DEFAULT_GEMINI_MODEL,
        api_base: str = DEFAULT_GEMINI_API_BASE,
    ) -> None:
        self.api_key = api_key
        self.model = model.removeprefix("google/")
        self.api_base = api_base.rstrip("/")

    def transcribe_page(self, image_path: Path) -> list[str]:
        payload = _build_gemini_payload(image_path)
        url = (
            f"{self.api_base}/models/{self.model}:generateContent"
            f"?key={urllib.parse.quote(self.api_key, safe='')}"
        )
        body = _post_gemini_json(url, payload, headers={}, provider_label="Gemini API")
        return _parse_gemini_generate_content(body)


class GeminiVertexTranscriber(VisionTranscriber):
    name = "gemini-vertex"

    def __init__(
        self,
        *,
        project_id: str,
        location: str,
        model: str = DEFAULT_GEMINI_MODEL,
        access_token_provider: Callable[[], str] | None = None,
    ) -> None:
        self.project_id = project_id
        self.location = location
        self.model = model.removeprefix("google/")
        self._access_token_provider = access_token_provider

    def _access_token(self) -> str:
        if self._access_token_provider is not None:
            return self._access_token_provider()
        from gemini_auth import get_vertex_access_token

        return get_vertex_access_token()

    def transcribe_page(self, image_path: Path) -> list[str]:
        payload = _build_gemini_payload(image_path)
        url = (
            f"https://{self.location}-aiplatform.googleapis.com/v1/"
            f"projects/{self.project_id}/locations/{self.location}/"
            f"publishers/google/models/{self.model}:generateContent"
        )
        body = _post_gemini_json(
            url,
            payload,
            headers={"Authorization": f"Bearer {self._access_token()}"},
            provider_label="Vertex Gemini",
        )
        return _parse_gemini_generate_content(body)


# Backward-compatible alias for older scripts.
GeminiGatewayTranscriber = GeminiApiTranscriber


class KrakenLocalTranscriber(VisionTranscriber):
    def __init__(self, *, name: str, runtime: object) -> None:
        self.name = name
        self.runtime = runtime

    def transcribe_page(self, image_path: Path) -> list[str]:
        segmented, _ = self.runtime.segmented_lines_with_ocr(image_path)  # type: ignore[attr-defined]
        lines = [segment.ocr_text.strip() for segment in segmented if segment.ocr_text.strip()]
        if not lines:
            raise RuntimeError(f"{self.name} produced no OCR lines")
        return lines


class TrOcrLocalTranscriber(VisionTranscriber):
    name = "trocr"

    def __init__(self, model_name: str = "microsoft/trocr-small-handwritten") -> None:
        import torch
        from PIL import Image
        from transformers import TrOCRProcessor, VisionEncoderDecoderModel

        self.torch = torch
        self.Image = Image
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.processor = TrOCRProcessor.from_pretrained(model_name)
        self.model = VisionEncoderDecoderModel.from_pretrained(model_name).to(self.device)
        self.model.eval()
        from kraken_gt.kraken_align import KrakenRuntime

        baseline = Path("ml/models/en_best.mlmodel")
        self.segment_runtime = KrakenRuntime(recognition_model=baseline, device="cpu")

    def transcribe_page(self, image_path: Path) -> list[str]:
        segmented, _ = self.segment_runtime.segmented_lines_with_ocr(image_path)
        lines: list[str] = []
        image = self.Image.open(image_path).convert("RGB")
        for segment in segmented:
            x0, y0, x1, y1 = segment.bbox
            crop = image.crop((x0, y0, x1, y1))
            if crop.width < 2 or crop.height < 2:
                continue
            pixel_values = self.processor(crop, return_tensors="pt").pixel_values.to(self.device)
            with self.torch.no_grad():
                generated = self.model.generate(pixel_values)
            text = self.processor.batch_decode(generated, skip_special_tokens=True)[0].strip()
            if text:
                lines.append(text)
        if not lines:
            raise RuntimeError("TrOCR produced no lines")
        return lines


def transcribe_with_cache(
    transcriber: VisionTranscriber,
    image_path: Path,
    page_id: str,
    cache_dir: Path,
) -> tuple[list[str], bool]:
    """Return (lines, from_cache)."""
    cache_file = cache_path_for(page_id, transcriber.name, cache_dir)
    cached = load_cached_lines(cache_file)
    if cached:
        return cached, True
    lines = transcriber.transcribe_page(image_path)
    save_cached_lines(cache_file, transcriber.name, page_id, lines, "\n".join(lines))
    return lines, False
