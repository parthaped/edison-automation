#!/usr/bin/env python3
"""Structured logging helpers for VL benchmark runs."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def setup_logger(name: str, log_file: Path | None = None) -> logging.Logger:
    logger = logging.getLogger(name)
    logger.setLevel(logging.INFO)
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(fmt)
    logger.addHandler(stream)

    if log_file is not None:
        log_file.parent.mkdir(parents=True, exist_ok=True)
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)

    return logger


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")


def log_generation(logger: logging.Logger, record: dict[str, Any]) -> None:
    logger.info(
        "model=%s document=%s page=%s in_tokens=%s out_tokens=%s elapsed_sec=%.2f tokens_per_min=%.1f",
        record.get("model"),
        record.get("document"),
        record.get("page"),
        record.get("input_tokens"),
        record.get("output_tokens"),
        float(record.get("elapsed_sec", 0)),
        float(record.get("tokens_per_min", 0)),
    )


def log_compare_result(logger: logging.Logger, record: dict[str, Any]) -> None:
    accuracy = record.get("accuracy") or {}
    logger.info(
        "COMPARE model=%s document=%s page=%s char=%.2f%% punct=%.2f%% cap=%.2f%% ws=%.2f%%",
        record.get("model"),
        record.get("document"),
        record.get("page"),
        float(accuracy.get("character", 0)),
        float(accuracy.get("punctuation", 0)),
        float(accuracy.get("capitalization", 0)),
        float(accuracy.get("whitespace", 0)),
    )
