#!/usr/bin/env python3
"""Download Qwen3-VL-8B-Instruct into ml/models/ for local transcription."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

DEFAULT_MODEL_ID = "Qwen/Qwen3-VL-8B-Instruct"
DEFAULT_OUTPUT = Path("ml/models/Qwen3-VL-8B-Instruct")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID, help="Hugging Face model ID.")
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help="Local directory for unquantized model weights.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise RuntimeError("Install huggingface_hub: pip install -r ml/requirements-qwen-vl.txt") from error

    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
    args.output.parent.mkdir(parents=True, exist_ok=True)

    print(f"Downloading {args.model_id} into {args.output}...")
    if not token:
        print("Tip: set HF_TOKEN or run `huggingface-cli login` if the repo is gated.")

    snapshot_download(
        repo_id=args.model_id,
        local_dir=str(args.output),
        token=token or None,
    )

    print(f"Model ready at {args.output.resolve()}")
    print("")
    print("Smoke test:")
    print(
        "  python ml/scripts/transcribe_qwen_vl.py "
        f"--image ml/data/raw/<doc>/<page>.jpg --model-dir {args.output.as_posix()}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
