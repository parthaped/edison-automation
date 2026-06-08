#!/usr/bin/env python3
"""Export Kraken .ckpt training checkpoints to loadable .safetensors weights."""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        help="Specific .ckpt file. If omitted, uses best checkpoint in --model-dir.",
    )
    parser.add_argument(
        "--model-dir",
        type=Path,
        default=Path("ml/models/edison-htr-phase2.mlmodel"),
        help="Directory containing checkpoint_*.ckpt files.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Output .safetensors path. Default: best_<score>.safetensors beside checkpoint.",
    )
    return parser.parse_args()


def resolve_ketos() -> str:
    venv_ketos = Path(sys.executable).with_name("ketos.exe" if sys.platform == "win32" else "ketos")
    if venv_ketos.exists():
        return str(venv_ketos)
    return "ketos"


def find_best_checkpoint(model_dir: Path) -> Path | None:
    best_score = -1.0
    best_path: Path | None = None
    for path in model_dir.glob("checkpoint_*.ckpt"):
        if "abort" in path.name:
            continue
        match = re.search(r"-(\d+\.\d+)\.ckpt$", path.name)
        if not match:
            continue
        score = float(match.group(1))
        if score > best_score:
            best_score = score
            best_path = path
    return best_path


def default_output_path(checkpoint: Path) -> Path:
    match = re.search(r"-(\d+\.\d+)\.ckpt$", checkpoint.name)
    score = match.group(1) if match else "0"
    return checkpoint.parent / f"best_{score}.safetensors"


def export_checkpoint(checkpoint: Path, output: Path) -> Path:
    if not checkpoint.exists():
        raise FileNotFoundError(checkpoint)
    output.parent.mkdir(parents=True, exist_ok=True)
    ketos = resolve_ketos()
    cmd = [ketos, "convert", "-o", str(output), str(checkpoint)]
    print(" ".join(cmd), file=sys.stderr)
    result = subprocess.run(cmd, cwd=Path(__file__).resolve().parents[2])
    if result.returncode != 0:
        raise RuntimeError(f"ketos convert failed with exit code {result.returncode}")
    if not output.exists():
        raise RuntimeError(f"Expected output not created: {output}")
    return output


def main() -> int:
    args = parse_args()
    checkpoint = args.checkpoint or find_best_checkpoint(args.model_dir)
    if checkpoint is None:
        raise SystemExit(f"No checkpoint found in {args.model_dir}")
    output = args.output or default_output_path(checkpoint)
    path = export_checkpoint(checkpoint, output)
    print(path.as_posix())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
