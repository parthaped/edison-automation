#!/usr/bin/env python3
"""Download Gemma 4 26B A4B Instruct to scratch for Amarel transcription."""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from scratch_paths import ensure_under_scratch, gemma_model_dir  # noqa: E402

DEFAULT_MODEL_ID = "google/gemma-4-26B-A4B-it"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID, help="Hugging Face model ID.")
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Local directory for unquantized model weights (default: scratch gemma path).",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = args.output or gemma_model_dir()
    ensure_under_scratch(output)

    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise RuntimeError(
            "Install huggingface_hub: pip install -r ml/requirements-vl-benchmark.txt"
        ) from error

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    output.parent.mkdir(parents=True, exist_ok=True)

    print(f"Downloading {args.model_id} into {output}...")
    if not token:
        print(
            "Tip: set HF_TOKEN, accept the Gemma license on Hugging Face, "
            "and run `huggingface-cli login`."
        )

    snapshot_download(
        repo_id=args.model_id,
        local_dir=str(output),
        token=token or None,
    )

    print(f"Model ready at {output.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
