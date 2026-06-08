#!/usr/bin/env python3
"""Resolve the best Edison Kraken recognition checkpoint for serving/benchmarks."""

from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--prefix",
        type=Path,
        default=Path("ml/models/edison-htr.mlmodel"),
        help="Training output prefix directory.",
    )
    parser.add_argument(
        "--fallback",
        type=Path,
        default=Path("ml/models/en_best.mlmodel"),
    )
    return parser.parse_args()


def resolve(prefix: Path, fallback: Path) -> Path:
    if prefix.is_dir():
        promoted = prefix / "promoted_guardrail.safetensors"
        if promoted.exists():
            return promoted
        safetensors = sorted(prefix.glob("best_*.safetensors"), reverse=True)
        if safetensors:
            return safetensors[0]
        checkpoints = sorted(prefix.glob("checkpoint_*.ckpt"), reverse=True)
        if checkpoints:
            return checkpoints[0]
    if prefix.exists():
        return prefix
    if fallback.exists():
        return fallback
    raise FileNotFoundError(f"No Kraken model found under {prefix} or {fallback}")


def main() -> int:
    args = parse_args()
    path = resolve(args.prefix, args.fallback)
    print(path.as_posix())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
