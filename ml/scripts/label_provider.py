#!/usr/bin/env python3
"""Resolve vision-OCR label provider: Gemini, Kraken phase-2, TrOCR, or baseline."""

from __future__ import annotations

import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


EDISON_GEMINI_API_KEY_ENV = "EDISON_GEMINI_API_KEY"
GEMINI_API_KEY_ALIASES = (
    EDISON_GEMINI_API_KEY_ENV,
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GEMINI_API_KEY",
    "GOOGLE_API_KEY",
)


def load_local_env() -> None:
    """Load .env.local for ML scripts."""
    loaded: dict[str, str] = {}
    for env_path in (REPO_ROOT / ".env.local", REPO_ROOT / ".env"):
        if not env_path.exists():
            continue
        for line in env_path.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key:
                loaded[key] = value

    for key, value in loaded.items():
        if key not in os.environ:
            os.environ[key] = value

    ensure_gemini_env()


def ensure_gemini_env() -> None:
    """Mirror Edison Gemini key for libraries that read GOOGLE_GENERATIVE_AI_API_KEY."""
    api_key = _gemini_api_key()
    if api_key:
        os.environ[EDISON_GEMINI_API_KEY_ENV] = api_key
        os.environ["GOOGLE_GENERATIVE_AI_API_KEY"] = api_key


load_local_env()

from kraken_gt.kraken_align import KrakenRuntime  # noqa: E402
from gemini_auth import (  # noqa: E402
    gemini_api_key,
    is_vertex_configured,
    vertex_location,
    vertex_project_id,
)
from vision_transcribe import (  # noqa: E402
    GeminiApiTranscriber,
    GeminiVertexTranscriber,
    KrakenLocalTranscriber,
    TrOcrLocalTranscriber,
    VisionTranscriber,
    cache_path_for,
    transcribe_with_cache,
)

DEFAULT_CACHE_DIR = Path("ml/data/cache/vision_labels")
PHASE2_DIR = Path("ml/models/edison-htr-phase2.mlmodel")
BASELINE_MODEL = Path("ml/models/en_best.mlmodel")


def resolve_phase2_model() -> Path | None:
    if PHASE2_DIR.is_dir():
        safetensors = sorted(PHASE2_DIR.glob("best_*.safetensors"), reverse=True)
        if safetensors:
            return safetensors[0]
        checkpoints = sorted(PHASE2_DIR.glob("checkpoint_*.ckpt"), reverse=True)
        if checkpoints:
            return checkpoints[0]
    return None


def _try_gemini(prefer: str) -> VisionTranscriber | None:
    if prefer not in ("auto", "gemini"):
        return None
    model = os.environ.get("EDISON_OCR_MODEL", "gemini-2.5-flash").strip()
    if is_vertex_configured():
        project_id = vertex_project_id()
        if not project_id:
            return None
        return GeminiVertexTranscriber(
            project_id=project_id,
            location=vertex_location(),
            model=model,
        )
    api_key = gemini_api_key()
    if not api_key:
        return None
    return GeminiApiTranscriber(api_key=api_key, model=model)


def _try_kraken_phase2(prefer: str, device: str) -> VisionTranscriber | None:
    if prefer not in ("auto", "kraken_phase2"):
        return None
    model = resolve_phase2_model()
    if model is None or not model.exists():
        return None
    runtime = KrakenRuntime(device=device, recognition_model=model)
    return KrakenLocalTranscriber(name="kraken_phase2", runtime=runtime)


def _try_trocr(prefer: str) -> VisionTranscriber | None:
    if prefer not in ("auto", "trocr"):
        return None
    try:
        return TrOcrLocalTranscriber()
    except Exception:
        return None


def _try_kraken_baseline(prefer: str, device: str) -> VisionTranscriber | None:
    if prefer not in ("auto", "kraken_baseline", "kraken_phase2"):
        return None
    if not BASELINE_MODEL.exists():
        return None
    runtime = KrakenRuntime(device=device, recognition_model=BASELINE_MODEL)
    return KrakenLocalTranscriber(name="kraken_baseline", runtime=runtime)


def resolve_label_provider(
    prefer: str = "auto",
    *,
    device: str = "cuda:0",
) -> VisionTranscriber:
    """Return the first usable vision-OCR provider."""
    if prefer == "gemini":
        provider = _try_gemini("gemini")
        if provider:
            return provider
        raise RuntimeError(
            "Gemini requested but not configured. Set EDISON_GCP_SERVICE_ACCOUNT_JSON "
            "+ EDISON_GCP_PROJECT_ID (Vertex), or EDISON_GEMINI_API_KEY."
        )

    if prefer == "kraken_phase2":
        provider = _try_kraken_phase2("kraken_phase2", device)
        if provider:
            return provider
        raise RuntimeError("kraken_phase2 requested but phase-2 model not found")

    if prefer == "trocr":
        provider = _try_trocr("trocr")
        if provider:
            return provider
        raise RuntimeError("trocr requested but dependencies/model unavailable")

    if prefer == "kraken_baseline":
        provider = _try_kraken_baseline("kraken_baseline", device)
        if provider:
            return provider
        raise RuntimeError("kraken_baseline requested but en_best.mlmodel not found")

    for resolver in (
        lambda: _try_gemini("auto"),
        lambda: _try_kraken_phase2("auto", device),
        lambda: _try_trocr("auto"),
        lambda: _try_kraken_baseline("auto", device),
    ):
        provider = resolver()
        if provider is not None:
            return provider

    raise RuntimeError(
        "No vision-OCR provider available. Configure Gemini (Vertex or API key) or install local Kraken/TrOCR models."
    )


def transcribe_page_cached(
    provider: VisionTranscriber,
    image_path: Path,
    page_id: str,
    cache_dir: Path = DEFAULT_CACHE_DIR,
) -> tuple[list[str], bool]:
    return transcribe_with_cache(provider, image_path, page_id, cache_dir)


def provider_cache_file(page_id: str, provider_name: str, cache_dir: Path = DEFAULT_CACHE_DIR) -> Path:
    return cache_path_for(page_id, provider_name, cache_dir)
