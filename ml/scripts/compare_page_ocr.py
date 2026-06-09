#!/usr/bin/env python3
"""Compare Kraken full-page OCR vs Qwen2.5-VL on the same Edison page image."""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from evaluate_predictions import cer, wer  # noqa: E402
from resolve_kraken_model import resolve as resolve_kraken_model  # noqa: E402
from transcribe_qwen_vl import QwenVlTranscriber  # noqa: E402

DEFAULT_COMPARE_DIR = Path("ml/reports/page_compare")
DEFAULT_KRAKEN_PREFIX = Path("ml/models/edison-htr.mlmodel")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True, help="Full page image path.")
    parser.add_argument(
        "--kraken-model",
        type=Path,
        default=None,
        help="Kraken recognition model (.mlmodel, .safetensors, or .ckpt).",
    )
    parser.add_argument(
        "--kraken-prefix",
        type=Path,
        default=DEFAULT_KRAKEN_PREFIX,
        help="Resolve Kraken model from training prefix when --kraken-model is omitted.",
    )
    parser.add_argument("--qwen-model-dir", type=Path, default=Path("ml/models/Qwen2.5-VL-7B-Instruct"))
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_COMPARE_DIR)
    parser.add_argument("--kraken-device", default=os.environ.get("EDISON_KRAKEN_DEVICE", "cuda:0"))
    parser.add_argument("--kraken-batch-size", type=int, default=16)
    parser.add_argument("--kraken-precision", default=os.environ.get("EDISON_KRAKEN_PRECISION", "bf16-mixed"))
    parser.add_argument("--kraken-num-line-workers", type=int, default=4)
    parser.add_argument("--qwen-max-new-tokens", type=int, default=4096)
    parser.add_argument("--qwen-cpu-offload", action="store_true", default=None)
    parser.add_argument("--qwen-no-cpu-offload", action="store_true")
    parser.add_argument(
        "--reference",
        default="",
        help="Optional reference transcript for CER/WER (e.g. diplomatic Scripto text).",
    )
    parser.add_argument("--reference-file", type=Path, default=None, help="Read reference from a text file.")
    parser.add_argument("--skip-kraken", action="store_true")
    parser.add_argument("--skip-qwen", action="store_true")
    return parser.parse_args()


def resolve_kraken_cli() -> str:
    venv_candidate = Path(sys.executable).with_name("kraken.exe" if os.name == "nt" else "kraken")
    if venv_candidate.exists():
        return str(venv_candidate)
    return "kraken"


def kraken_subprocess_env() -> dict[str, str]:
    env = os.environ.copy()
    env.setdefault("PYTHONIOENCODING", "utf-8")
    env.setdefault("PYTHONUTF8", "1")
    return env


def run_kraken_full_page(
    image_path: Path,
    model_path: Path,
    output_path: Path,
    *,
    device: str,
    batch_size: int,
    precision: str,
    num_line_workers: int,
) -> str:
    kraken_cli = resolve_kraken_cli()
    if subprocess.run(
        [kraken_cli, "--help"],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        env=kraken_subprocess_env(),
    ).returncode != 0:
        raise RuntimeError("kraken CLI is not installed. Run setup_kraken_cuda.ps1.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        kraken_cli,
        "-i",
        str(image_path),
        str(output_path),
        "--device",
        device,
        "--precision",
        precision,
        "segment",
        "-bl",
        "ocr",
        "-m",
        str(model_path),
        "-B",
        str(batch_size),
        "--num-line-workers",
        str(num_line_workers),
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=kraken_subprocess_env(),
        timeout=600,
    )
    if result.returncode != 0:
        stderr = (result.stderr or "").strip()
        raise RuntimeError(stderr or f"kraken exited with {result.returncode}")
    if not output_path.exists():
        raise RuntimeError(f"kraken did not write output to {output_path}")
    return output_path.read_text(encoding="utf-8").strip()


def load_reference(args: argparse.Namespace) -> str:
    if args.reference_file:
        return args.reference_file.read_text(encoding="utf-8").strip()
    return args.reference.strip()


def print_metrics(label: str, reference: str, prediction: str) -> None:
    if not reference:
        return
    print(f"{label} CER: {cer(reference, prediction):.4f}")
    print(f"{label} WER: {wer(reference, prediction):.4f}")


def main() -> int:
    args = parse_args()
    image_path = args.image
    if not image_path.is_absolute():
        image_path = REPO_ROOT / image_path
    if not image_path.exists():
        raise RuntimeError(f"Image not found: {image_path}")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    stem = image_path.stem
    kraken_out = args.output_dir / f"{stem}.kraken.txt"
    qwen_out = args.output_dir / f"{stem}.qwen-vl.txt"
    reference = load_reference(args)

    kraken_text = ""
    if not args.skip_kraken:
        model_path = args.kraken_model or resolve_kraken_model(
            args.kraken_prefix,
            Path("ml/models/en_best.mlmodel"),
        )
        if not model_path.is_absolute():
            model_path = REPO_ROOT / model_path
        print(f"Running Kraken ({model_path.name})...", file=sys.stderr)
        kraken_text = run_kraken_full_page(
            image_path,
            model_path,
            kraken_out,
            device=args.kraken_device,
            batch_size=args.kraken_batch_size,
            precision=args.kraken_precision,
            num_line_workers=args.kraken_num_line_workers,
        )
        print(f"Wrote {kraken_out}", file=sys.stderr)

    qwen_text = ""
    if not args.skip_qwen:
        print("Running Qwen2.5-VL (4-bit)...", file=sys.stderr)
        qwen_cpu_offload: bool | None = None
        if args.qwen_no_cpu_offload:
            qwen_cpu_offload = False
        elif args.qwen_cpu_offload:
            qwen_cpu_offload = True
        transcriber = QwenVlTranscriber(
            model_dir=args.qwen_model_dir,
            max_new_tokens=args.qwen_max_new_tokens,
            cpu_offload=qwen_cpu_offload,
        )
        lines, _ = transcriber.transcribe_page(image_path)
        qwen_text = "\n".join(lines)
        qwen_out.write_text(qwen_text + "\n", encoding="utf-8")
        print(f"Wrote {qwen_out}", file=sys.stderr)

    if not args.skip_kraken:
        print("\n" + "=" * 72)
        print("KRAKEN")
        print("=" * 72)
        print(kraken_text or "(empty)")
        print_metrics("Kraken", reference, kraken_text)

    if not args.skip_qwen:
        print("\n" + "=" * 72)
        print("QWEN2.5-VL")
        print("=" * 72)
        print(qwen_text or "(empty)")
        print_metrics("Qwen", reference, qwen_text)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
