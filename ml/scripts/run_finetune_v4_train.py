#!/usr/bin/env python3
"""Run ketos train + post-train frozen-52 eval for finetune v4."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parents[1]


def run(cmd: list[str], log_path: Path) -> int:
    with log_path.open("a", encoding="utf-8") as log:
        log.write(f"\n=== {' '.join(cmd)} ===\n")
        log.flush()
        proc = subprocess.Popen(
            cmd,
            cwd=REPO,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            env={
            **dict(**__import__("os").environ),
            "PYTHONUTF8": "1",
            "PYTHONUNBUFFERED": "1",
            "PYTHONIOENCODING": "utf-8",
        },
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            try:
                print(line, end="", flush=True)
            except UnicodeEncodeError:
                print(line.encode("ascii", errors="replace").decode("ascii"), end="", flush=True)
            log.write(line)
        return proc.wait()


def find_best_checkpoint(model_dir: Path) -> Path | None:
    best_score = -1.0
    best: Path | None = None
    for path in model_dir.glob("checkpoint_*.ckpt"):
        match = re.search(r"-(\d+\.\d+)\.ckpt$", path.name)
        if not match:
            continue
        score = float(match.group(1))
        if score > best_score:
            best_score = score
            best = path
    return best


def summarize_benchmark(path: Path) -> dict[str, float | int]:
    cers = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            cers.append(float(json.loads(line)["cer"]))
    if not cers:
        return {"count": 0, "char_accuracy": 0.0}
    avg = sum(cers) / len(cers)
    return {"count": len(cers), "char_accuracy": round((1 - avg) * 100, 2) / 100.0}


def main() -> int:
    py = REPO / "ml/.venv/Scripts/python.exe"
    ketos = REPO / "ml/.venv/Scripts/ketos.exe"
    log = REPO / "ml/reports/finetune_v4_train.log"
    init_ckpt = REPO / "ml/models/edison-htr-quality.mlmodel/checkpoint_04-0.9179.ckpt"
    out_dir = REPO / "ml/models/edison-htr-finetune-v4.mlmodel"
    arrow = REPO / "ml/data/manifests/edison_recognition_finetune_v4.arrow"
    out_dir.mkdir(parents=True, exist_ok=True)

    code = run(
        [
            str(ketos),
            "--workers",
            "0",
            "train",
            "-f",
            "binary",
            "-i",
            str(init_ckpt),
            "-o",
            str(out_dir),
            "--resize",
            "union",
            str(arrow),
            "-N",
            "30",
        ],
        log,
    )
    if code != 0:
        print(f"ketos train failed: {code}", file=sys.stderr)
        return code

    best = find_best_checkpoint(out_dir)
    if not best:
        print("No checkpoint produced", file=sys.stderr)
        return 1

    run([str(py), str(SCRIPT_DIR / "export_kraken_checkpoint.py"), "--model-dir", str(out_dir)], log)
    safetensors = sorted(out_dir.glob("best_*.safetensors"), reverse=True)
    model_path = safetensors[0] if safetensors else best

    run(
        [
            str(py),
            str(SCRIPT_DIR / "export_lines_from_pagexml.py"),
            "--page-list",
            str(REPO / "ml/data/manifests/frozen_test_52_pagexml.txt"),
            "--manifest",
            str(REPO / "ml/data/manifests/kraken_gt_manifest.pre_upgrade.jsonl"),
            "--output",
            str(REPO / "ml/data/manifests/line_crops_frozen52.jsonl"),
            "--crop",
        ],
        log,
    )
    bench_out = REPO / "ml/reports/benchmark_finetune_v4_frozen52.jsonl"
    run(
        [
            str(py),
            str(SCRIPT_DIR / "benchmark_models.py"),
            "--manifest",
            str(REPO / "ml/data/manifests/line_crops_frozen52.jsonl"),
            "--split",
            "all",
            "--models",
            "kraken",
            "--kraken-model",
            str(model_path),
            "--kraken-mode",
            "recognition",
            "--output",
            str(bench_out),
        ],
        log,
    )

    metrics = summarize_benchmark(bench_out)
    state_path = REPO / "ml/data/manifests/quality_iterate_state.json"
    state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {}
    val_match = re.search(r"-(\d+\.\d+)\.ckpt$", best.name)
    record = {
        "round": "finetune_v4",
        "frozen52_line_char_accuracy": metrics["char_accuracy"],
        "frozen52_line_count": metrics["count"],
        "checkpoint": str(best),
        "safetensors": str(model_path),
        "training_val_accuracy": float(val_match.group(1)) if val_match else None,
    }
    history = state.get("history") or []
    history.append(record)
    state.update(
        {
            "best_line_char_accuracy": max(float(state.get("best_line_char_accuracy") or 0), metrics["char_accuracy"]),
            "best_checkpoint": str(best),
            "best_safetensors": str(model_path),
            "history": history,
        }
    )
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    iterative = REPO / "ml/data/manifests/iterative_train_state.json"
    if iterative.exists():
        idata = json.loads(iterative.read_text(encoding="utf-8"))
        idata["best_line_char_accuracy_frozen52"] = metrics["char_accuracy"]
        idata["best_checkpoint"] = str(best).replace("\\", "/")
        idata["best_safetensors"] = str(model_path).replace("\\", "/")
        idata.setdefault("history", []).append(record)
        iterative.write_text(json.dumps(idata, indent=2), encoding="utf-8")

    print(f"Frozen-52 line char accuracy: {metrics['char_accuracy']:.1%} ({metrics['count']} lines)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
