#!/usr/bin/env python3
"""Iteratively harvest Edison Scripto pages, refine GT with OCR, train, and evaluate.

Runs until validation character accuracy reaches the target (default 70%) or
max iterations / plateau is hit.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from evaluate_kraken_recognition import evaluate_model, resolve_ketos  # noqa: E402
from export_kraken_checkpoint import export_checkpoint, default_output_path  # noqa: E402


@dataclass
class IterationState:
    iteration: int = 0
    best_val_accuracy: float = 0.0
    best_checkpoint: str = ""
    target_accuracy: float = 0.70
    plateau_count: int = 0
    history: list[dict[str, object]] | None = None

    def __post_init__(self) -> None:
        if self.history is None:
            self.history = []


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-accuracy", type=float, default=0.70)
    parser.add_argument("--max-iterations", type=int, default=8)
    parser.add_argument("--plateau-patience", type=int, default=2)
    parser.add_argument("--harvest-batch", type=int, default=300, help="New Omeka pages per iteration.")
    parser.add_argument("--ocr-refine-limit", type=int, default=120)
    parser.add_argument("--max-epochs", type=int, default=25)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--base-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--state", type=Path, default=Path("ml/data/manifests/iterative_train_state.json"))
    parser.add_argument("--output-model-dir", type=Path, default=Path("ml/models/edison-htr-iterative.mlmodel"))
    parser.add_argument("--skip-harvest", action="store_true")
    parser.add_argument("--skip-refine", action="store_true")
    parser.add_argument("--skip-train", action="store_true", help="Only harvest/refine/curate.")
    return parser.parse_args()


def load_state(path: Path) -> IterationState:
    if not path.exists():
        return IterationState()
    data = json.loads(path.read_text(encoding="utf-8"))
    return IterationState(**data)


def save_state(path: Path, state: IterationState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(state), indent=2), encoding="utf-8")


def run_command(cmd: list[str], label: str) -> None:
    print(f"\n=== {label} ===", file=sys.stderr)
    print(" ".join(cmd), file=sys.stderr)
    result = subprocess.run(cmd, cwd=SCRIPT_DIR.parents[1])
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {result.returncode}")


def python_exe() -> str:
    return sys.executable




def recognition_model_for_refine(checkpoint_or_model: Path, fallback: Path) -> Path:
    """Kraken OCR refine needs .mlmodel or .safetensors; ketos checkpoints are .ckpt only."""
    if checkpoint_or_model.suffix == ".ckpt":
        candidates = sorted(checkpoint_or_model.parent.glob("best_*.safetensors"), reverse=True)
        if candidates:
            return candidates[0]
        if fallback.exists():
            return fallback
    if checkpoint_or_model.exists():
        return checkpoint_or_model
    return fallback


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


def curate_and_compile(iteration: int) -> tuple[Path, Path, int]:
    repo = SCRIPT_DIR.parents[1]
    train_list = repo / "ml/data/manifests/iterative_train_pagexml.txt"
    test_list = repo / "ml/data/manifests/iterative_test_pagexml.txt"
    train_arrow = repo / f"ml/data/manifests/edison_recognition_iter_{iteration:02d}.arrow"
    test_arrow = repo / f"ml/data/manifests/edison_recognition_test_iter_{iteration:02d}.arrow"

    run_command(
        [
            python_exe(),
            str(SCRIPT_DIR / "prepare_phase2_training.py"),
            "--train-list",
            str(train_list),
            "--include-tier-b",
            "--output",
            str(repo / f"ml/data/manifests/phase2_curation_iter_{iteration:02d}.jsonl"),
        ],
        "Curate training pages",
    )

    # Export held-out test PAGE XML list from manifest.
    manifest = repo / "ml/data/manifests/kraken_gt_manifest.jsonl"
    test_paths: list[str] = []
    with manifest.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            if row.get("split") != "test":
                continue
            path = row.get("pagexml_path")
            if path and Path(path).exists():
                test_paths.append(str(Path(path)))
    test_list.write_text("\n".join(sorted(set(test_paths))) + ("\n" if test_paths else ""), encoding="utf-8")

    run_command(
        [
            python_exe(),
            str(SCRIPT_DIR / "compile_kraken_dataset.py"),
            "--page-list",
            str(train_list),
            "--output",
            str(train_arrow),
            "--num-workers",
            "0",
        ],
        "Compile training Arrow dataset",
    )

    if test_paths:
        run_command(
            [
                python_exe(),
                str(SCRIPT_DIR / "compile_kraken_dataset.py"),
                "--page-list",
                str(test_list),
                "--output",
                str(test_arrow),
                "--num-workers",
                "0",
            ],
            "Compile test Arrow dataset",
        )

    train_count = len(train_list.read_text(encoding="utf-8").splitlines()) if train_list.exists() else 0
    return train_arrow, test_arrow, train_count


def train_model(
    base_model: Path,
    output_dir: Path,
    train_arrow: Path,
    max_epochs: int,
) -> Path | None:
    output_dir.mkdir(parents=True, exist_ok=True)
    ketos = resolve_ketos()
    cmd = [
        ketos,
        "--workers",
        "0",
        "train",
        "-f",
        "binary",
        "-i",
        str(base_model),
        "-o",
        str(output_dir),
        "--resize",
        "union",
        str(train_arrow),
        "-N",
        str(max_epochs),
    ]
    env = {**dict(**__import__("os").environ), "PYTHONUTF8": "1"}
    print(f"\n=== Train Kraken ===\n{' '.join(cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, cwd=SCRIPT_DIR.parents[1], env=env)
    if result.returncode != 0:
        raise RuntimeError(f"Training failed with exit code {result.returncode}")
    return find_best_checkpoint(output_dir)


def evaluate_checkpoint(checkpoint: Path, test_arrow: Path, train_arrow: Path) -> float:
    eval_arrow = test_arrow if test_arrow.exists() else train_arrow
    if not eval_arrow.exists():
        match = re.search(r"-(\d+\.\d+)\.ckpt$", checkpoint.name)
        if match:
            return float(match.group(1))
        return 0.0
    ketos = resolve_ketos()
    try:
        metrics = evaluate_model(ketos, checkpoint, eval_arrow, 0)
        raw = metrics.get("character_accuracy", "0").rstrip("%")
        return float(raw) / 100.0
    except Exception as error:
        print(f"Evaluation failed ({error}); using checkpoint score.", file=sys.stderr)
        match = re.search(r"-(\d+\.\d+)\.ckpt$", checkpoint.name)
        return float(match.group(1)) if match else 0.0


def main() -> int:
    args = parse_args()
    repo = SCRIPT_DIR.parents[1]
    state = load_state(args.state)
    state.target_accuracy = args.target_accuracy

    for iteration in range(state.iteration, args.max_iterations):
        print(f"\n######## Iteration {iteration + 1}/{args.max_iterations} ########", file=sys.stderr)
        iter_model_dir = args.output_model_dir.parent / f"{args.output_model_dir.name}_iter{iteration + 1:02d}"

        if not args.skip_harvest:
            harvest_cmd = [
                python_exe(),
                str(SCRIPT_DIR / "build_hybrid_ground_truth.py"),
                "--limit",
                str(args.harvest_batch),
                "--unprocessed-only",
                "--resume",
                "--device",
                args.device,
            ]
            run_command(harvest_cmd, f"Harvest batch ({args.harvest_batch} unprocessed pages)")

        base_for_refine = Path(state.best_checkpoint) if state.best_checkpoint else args.base_model
        refine_model = recognition_model_for_refine(base_for_refine, args.base_model)
        if not args.skip_refine and refine_model.exists():
            run_command(
                [
                    python_exe(),
                    str(SCRIPT_DIR / "refine_gt_with_ocr.py"),
                    "--kraken-model",
                    str(refine_model),
                    "--device",
                    args.device,
                    "--limit",
                    str(args.ocr_refine_limit),
                    "--require-transcript-type",
                    "diplomatic",
                ],
                "OCR-assisted refine of rejected pages",
            )

        train_arrow, test_arrow, train_pages = curate_and_compile(iteration + 1)
        if train_pages == 0:
            print("No training pages after curation; stopping.", file=sys.stderr)
            break

        if args.skip_train:
            state.iteration = iteration + 1
            save_state(args.state, state)
            continue

        init_model = Path(state.best_checkpoint) if state.best_checkpoint and Path(state.best_checkpoint).exists() else args.base_model
        best_ckpt = train_model(init_model, iter_model_dir, train_arrow, args.max_epochs)
        if best_ckpt is None:
            print("Training produced no checkpoint.", file=sys.stderr)
            break

        if best_ckpt.suffix == ".ckpt":
            safetensors_path = default_output_path(best_ckpt)
            try:
                export_checkpoint(best_ckpt, safetensors_path)
                print(f"Exported safetensors: {safetensors_path}", file=sys.stderr)
            except Exception as error:
                print(f"Safetensors export failed ({error})", file=sys.stderr)

        val_accuracy = evaluate_checkpoint(best_ckpt, test_arrow, train_arrow)
        print(f"Iteration {iteration + 1} val character accuracy: {val_accuracy:.1%}", file=sys.stderr)

        improved = val_accuracy > state.best_val_accuracy + 0.005
        if improved:
            state.best_val_accuracy = val_accuracy
            state.best_checkpoint = str(best_ckpt)
            state.plateau_count = 0
        else:
            state.plateau_count += 1

        state.history.append(
            {
                "iteration": iteration + 1,
                "train_pages": train_pages,
                "val_accuracy": val_accuracy,
                "checkpoint": str(best_ckpt),
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
        )
        state.iteration = iteration + 1
        save_state(args.state, state)

        report_path = repo / "ml/reports/iterative_train_history.jsonl"
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with report_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(state.history[-1], ensure_ascii=False) + "\n")

        if val_accuracy >= args.target_accuracy:
            print(f"Target accuracy {args.target_accuracy:.0%} reached.", file=sys.stderr)
            break
        if state.plateau_count >= args.plateau_patience:
            print("Accuracy plateaued; stopping iterative loop.", file=sys.stderr)
            break

    print(
        f"\nBest val accuracy: {state.best_val_accuracy:.1%} "
        f"checkpoint={state.best_checkpoint or 'none'}",
        file=sys.stderr,
    )
    return 0 if state.best_val_accuracy > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
