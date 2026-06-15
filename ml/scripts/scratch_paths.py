#!/usr/bin/env python3
"""Scratch path helpers for Amarel VL benchmark runs."""

from __future__ import annotations

import os
from pathlib import Path


def scratch_root() -> Path:
    user = os.environ.get("USER") or os.environ.get("USERNAME") or "unknown"
    return Path(os.environ.get("EDISON_SCRATCH_ROOT", f"/scratch/{user}/edison-automation"))


def model_root() -> Path:
    return Path(os.environ.get("EDISON_MODEL_ROOT", scratch_root() / "models"))


def qwen_model_dir() -> Path:
    override = os.environ.get("EDISON_QWEN_MODEL_DIR")
    if override:
        return Path(override)
    return model_root() / "qwen3-vl-30b-a3b"


def gemma_model_dir() -> Path:
    override = os.environ.get("EDISON_GEMMA_MODEL_DIR")
    if override:
        return Path(override)
    return model_root() / "gemma-4-26b-a4b-it"


def data_dir() -> Path:
    override = os.environ.get("EDISON_DATA_DIR")
    if override:
        return Path(override)
    return scratch_root() / "data" / "sources-with-transcript"


def run_dir(job_id: str | None = None) -> Path:
    override = os.environ.get("EDISON_RUN_DIR")
    if override:
        return Path(override)
    jid = job_id or os.environ.get("SLURM_JOB_ID", "manual")
    return scratch_root() / "runs" / jid


def logs_dir() -> Path:
    return scratch_root() / "logs"


def hf_cache_dir() -> Path:
    return Path(os.environ.get("HF_HOME", scratch_root() / "hf-cache"))


def gpu_venv_dir() -> Path:
    return scratch_root() / ".venv-vl-bench"


def compare_venv_dir() -> Path:
    return scratch_root() / ".venv-compare"


def ensure_under_scratch(path: Path) -> None:
    """When EDISON_SCRATCH_ROOT is set, refuse writes outside scratch."""
    root = os.environ.get("EDISON_SCRATCH_ROOT")
    if not root:
        return
    scratch = Path(root).resolve()
    try:
        path.resolve().relative_to(scratch)
    except ValueError as error:
        raise RuntimeError(
            f"Refusing to write outside EDISON_SCRATCH_ROOT ({scratch}): {path}"
        ) from error
