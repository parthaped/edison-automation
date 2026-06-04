#!/usr/bin/env python3
"""Verify CUDA PyTorch and optional Kraken CLI before serving local OCR."""

from __future__ import annotations

import sys


def main() -> int:
    try:
        import torch
    except ImportError:
        print("torch is not installed", file=sys.stderr)
        return 1

    cuda = torch.cuda.is_available()
    print(f"cuda: {cuda}")
    if cuda:
        print(f"device: {torch.cuda.get_device_name(0)}")
        props = torch.cuda.get_device_properties(0)
        print(f"vram_gb: {props.total_memory / (1024 ** 3):.2f}")
    else:
        print("device: NONE", file=sys.stderr)
        print(
            "Install CUDA PyTorch: pip install torch --index-url "
            "https://download.pytorch.org/whl/cu124",
            file=sys.stderr,
        )
        return 1

    try:
        import subprocess

        result = subprocess.run(
            ["kraken", "--help"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            print("kraken CLI not available", file=sys.stderr)
            return 1
        print("kraken: ok")
    except (FileNotFoundError, subprocess.TimeoutExpired):
        print("kraken CLI not found on PATH", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
