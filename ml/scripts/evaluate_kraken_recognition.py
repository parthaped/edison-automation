#!/usr/bin/env python3
"""Evaluate Kraken recognition models on a compiled binary dataset via ketos test."""

from __future__ import annotations

import argparse
import csv
import re
import subprocess
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dataset",
        type=Path,
        default=Path("ml/data/manifests/edison_recognition.arrow"),
    )
    parser.add_argument(
        "--models",
        nargs="+",
        default=[
            "ml/models/en_best.mlmodel",
            "ml/models/edison-htr-finetuned.mlmodel",
        ],
        help="Recognition model paths (.mlmodel). Checkpoints: convert with ketos convert first.",
    )
    parser.add_argument("--output-dir", type=Path, default=Path("ml/reports"))
    parser.add_argument(
        "--training-metrics",
        nargs="*",
        default=[],
        help="Extra CSV rows as model=path,character_accuracy=NN.NN% (for checkpoints ketos cannot load).",
    )
    parser.add_argument("--workers", type=int, default=0)
    return parser.parse_args()


def resolve_ketos() -> str:
    venv_ketos = Path(sys.executable).with_name("ketos.exe" if sys.platform == "win32" else "ketos")
    if venv_ketos.exists():
        return str(venv_ketos)
    return "ketos"


def parse_ketos_report(output: str) -> dict[str, str]:
    metrics: dict[str, str] = {}
    for line in output.splitlines():
        match = re.match(r"^(\d+)\s+(Characters|Errors)$", line.strip())
        if match:
            metrics[match.group(2).lower()] = match.group(1)
            continue
        match = re.match(r"^([\d.]+%)\s+(Character Accuracy|Word Accuracy.*)$", line.strip())
        if match:
            key = match.group(2).lower().replace(" ", "_").replace("(", "").replace(")", "")
            metrics[key] = match.group(1)
    return metrics


def evaluate_model(ketos: str, model_path: Path, dataset: Path, workers: int) -> dict[str, str]:
    if not model_path.exists():
        raise FileNotFoundError(model_path)
    env = dict(**{k: v for k, v in __import__("os").environ.items()})
    env["PYTHONUTF8"] = "1"
    result = subprocess.run(
        [ketos, f"--workers={workers}", "test", "-f", "binary", "-m", str(model_path), str(dataset)],
        capture_output=True,
        text=True,
        env=env,
    )
    combined = (result.stdout or "") + "\n" + (result.stderr or "")
    if result.returncode != 0 and "Character Accuracy" not in combined:
        raise RuntimeError(f"ketos test failed for {model_path}:\n{combined[-4000:]}")
    metrics = parse_ketos_report(combined)
    metrics["model"] = str(model_path)
    char_acc = metrics.get("character_accuracy", "").rstrip("%")
    if char_acc:
        try:
            metrics["cer"] = f"{100.0 - float(char_acc):.2f}%"
        except ValueError:
            pass
    return metrics


def main() -> int:
    args = parse_args()
    if not args.dataset.exists():
        raise SystemExit(f"Dataset not found: {args.dataset}. Run compile_kraken_dataset.py first.")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    ketos = resolve_ketos()
    rows: list[dict[str, str]] = []

    for model_path in args.models:
        path = Path(model_path)
        print(f"Evaluating {path} ...", file=sys.stderr)
        try:
            metrics = evaluate_model(ketos, path, args.dataset, args.workers)
            rows.append(metrics)
            print(f"  character_accuracy={metrics.get('character_accuracy', 'n/a')}", file=sys.stderr)
        except Exception as error:
            print(f"  skipped: {error}", file=sys.stderr)
            rows.append({"model": str(path), "error": str(error).replace("\n", " ")[:240]})

    for entry in args.training_metrics:
        parts = dict(item.split("=", 1) for item in entry.split(",") if "=" in item)
        if "model" not in parts and entry:
            parts["model"] = entry.split(",")[0]
        char_acc = parts.get("character_accuracy", "").rstrip("%")
        if char_acc:
            try:
                parts["cer"] = f"{100.0 - float(char_acc):.2f}%"
            except ValueError:
                pass
        parts["source"] = "training_validation"
        rows.append(parts)

    summary_path = args.output_dir / "kraken_recognition_eval.csv"
    fieldnames = sorted({key for row in rows for key in row})
    with summary_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"Wrote {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
