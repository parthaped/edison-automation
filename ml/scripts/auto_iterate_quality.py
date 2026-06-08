#!/usr/bin/env python3
"""Monitor quality curriculum, evaluate, revise GT/training, and rerun until plateau."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from evaluate_predictions import cer  # noqa: E402
from export_kraken_checkpoint import default_output_path, export_checkpoint  # noqa: E402


@dataclass
class QualityIterateState:
    round: int = 0
    best_line_char_accuracy: float = 0.0
    best_checkpoint: str = ""
    best_safetensors: str = ""
    plateau_count: int = 0
    history: list[dict[str, object]] = field(default_factory=list)


ROUND_PLANS: list[dict[str, object]] = [
    {
        "name": "quality_baseline",
        "skip_upgrade": False,
        "salvage_limit": 150,
        "max_line_cer": 0.28,
        "tier_a_only": True,
        "include_tier_b": False,
        "harvest_limit": 0,
        "ocr_refine_limit": 0,
        "relabel_review_limit": 0,
        "max_epochs": 40,
    },
    {
        "name": "expand_salvage_tier_b",
        "skip_upgrade": True,
        "salvage_limit": 300,
        "max_line_cer": 0.30,
        "tier_a_only": False,
        "include_tier_b": True,
        "harvest_limit": 120,
        "ocr_refine_limit": 100,
        "relabel_review_limit": 80,
        "max_epochs": 35,
    },
    {
        "name": "harvest_and_refine",
        "skip_upgrade": True,
        "salvage_limit": 200,
        "max_line_cer": 0.32,
        "tier_a_only": False,
        "include_tier_b": True,
        "harvest_limit": 200,
        "ocr_refine_limit": 180,
        "relabel_review_limit": 120,
        "max_epochs": 35,
    },
    {
        "name": "loosen_confidence",
        "skip_upgrade": True,
        "salvage_limit": 150,
        "max_line_cer": 0.35,
        "tier_a_only": False,
        "include_tier_b": True,
        "harvest_limit": 100,
        "ocr_refine_limit": 120,
        "relabel_review_limit": 100,
        "max_epochs": 30,
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", type=Path, default=Path("ml/data/manifests/quality_iterate_state.json"))
    parser.add_argument("--max-rounds", type=int, default=6)
    parser.add_argument("--plateau-patience", type=int, default=2)
    parser.add_argument("--min-improvement", type=float, default=0.005)
    parser.add_argument("--poll-seconds", type=int, default=120)
    parser.add_argument("--target-line-accuracy", type=float, default=0.55)
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--start-round", type=int, default=-1, help="-1 = resume from state.round")
    return parser.parse_args()


def python_exe() -> str:
    venv = REPO / "ml/.venv/Scripts/python.exe"
    return str(venv if venv.exists() else sys.executable)


def ketos_exe() -> str:
    venv = REPO / "ml/.venv/Scripts/ketos.exe"
    return str(venv if venv.exists() else "ketos")


def load_state(path: Path) -> QualityIterateState:
    if not path.exists():
        return QualityIterateState()
    return QualityIterateState(**json.loads(path.read_text(encoding="utf-8")))


def save_state(path: Path, state: QualityIterateState) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(asdict(state), indent=2), encoding="utf-8")


def log(msg: str) -> None:
    line = f"[{datetime.now(timezone.utc).isoformat()}] {msg}"
    print(line, flush=True)
    log_path = REPO / "ml/reports/auto_iterate_quality.log"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        handle.write(line + "\n")


def run(cmd: list[str], label: str) -> int:
    log(f"RUN {label}: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=REPO, env={**os.environ, "PYTHONUTF8": "1", "PYTHONUNBUFFERED": "1"})
    if result.returncode != 0:
        log(f"FAIL {label} exit={result.returncode}")
    return result.returncode


def pipeline_busy() -> bool:
    markers = (
        "upgrade_gt_manifest",
        "refine_gt_with_vision",
        "build_confidence_pagexml",
        "edison-htr-quality",
        "train_quality_curriculum",
        "run_overnight_pipeline",
    )
    script = (
        "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | "
        "ForEach-Object { $_.CommandLine } ; "
        "Get-CimInstance Win32_Process -Filter \"Name='ketos.exe'\" | "
        "ForEach-Object { $_.CommandLine }"
    )
    result = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        cwd=REPO,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    blob = result.stdout or ""
    return any(marker in blob for marker in markers)


def wait_for_idle(poll_seconds: int) -> None:
    while pipeline_busy():
        log(f"Pipeline busy; sleeping {poll_seconds}s")
        time.sleep(poll_seconds)


def find_best_checkpoint(model_dir: Path) -> Path | None:
    best_score = -1.0
    best_path: Path | None = None
    if not model_dir.is_dir():
        return None
    for path in model_dir.glob("checkpoint_*.ckpt"):
        match = re.search(r"-(\d+\.\d+)\.ckpt$", path.name)
        if not match:
            continue
        score = float(match.group(1))
        if score > best_score:
            best_score = score
            best_path = path
    return best_path


def resolve_init_model(state: QualityIterateState) -> Path:
    if state.best_checkpoint and Path(state.best_checkpoint).exists():
        return Path(state.best_checkpoint)
    for candidate in (
        REPO / "ml/models/edison-htr-quality.mlmodel",
        REPO / "ml/models/edison-htr-phase3.mlmodel",
        REPO / "ml/models/edison-htr-phase2.mlmodel",
    ):
        ckpt = find_best_checkpoint(candidate)
        if ckpt:
            return ckpt
    return REPO / "ml/models/edison-htr-phase3.mlmodel/checkpoint_10-0.4980.ckpt"


def summarize_line_benchmark(path: Path) -> dict[str, float | int]:
    if not path.exists():
        return {"count": 0, "char_accuracy": 0.0, "near_correct_pct": 0.0, "avg_cer": 1.0}
    cers: list[float] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                cers.append(float(json.loads(line).get("cer", 1.0)))
    if not cers:
        return {"count": 0, "char_accuracy": 0.0, "near_correct_pct": 0.0, "avg_cer": 1.0}
    near = sum(1 for value in cers if value <= 0.10)
    avg_cer = sum(cers) / len(cers)
    return {
        "count": len(cers),
        "char_accuracy": round((1.0 - avg_cer) * 100, 2) / 100.0,
        "near_correct_pct": round(near / len(cers) * 100, 2) / 100.0,
        "avg_cer": round(avg_cer, 4),
    }


def evaluate_model(safetensors: Path, round_id: int) -> dict[str, float | int]:
    py = python_exe()
    manifest = REPO / "ml/data/manifests/line_crops_eval.jsonl"
    run(
        [
            py,
            str(SCRIPT_DIR / "export_lines_from_pagexml.py"),
            "--manifest",
            str(REPO / "ml/data/manifests/kraken_gt_manifest.jsonl"),
            "--output",
            str(manifest),
            "--crop",
        ],
        "export eval line crops",
    )
    pred_path = REPO / f"ml/reports/benchmark_predictions_round{round_id:02d}.jsonl"
    run(
        [
            py,
            str(SCRIPT_DIR / "benchmark_models.py"),
            "--manifest",
            str(manifest),
            "--split",
            "test",
            "--models",
            "kraken",
            "--kraken-model",
            str(safetensors),
            "--kraken-mode",
            "recognition",
            "--output",
            str(pred_path),
        ],
        "benchmark kraken on test lines",
    )
    return summarize_line_benchmark(pred_path)


def relabel_review_pages(limit: int) -> None:
    py = python_exe()
    run(
        [
            py,
            str(SCRIPT_DIR / "refine_gt_with_vision.py"),
            "--limit",
            str(limit),
            "--reason-prefix",
            "upgrade_qc:",
            "--require-transcript-type",
            "diplomatic",
        ],
        "relabel QC-demoted pages",
    )


def execute_round(
    round_id: int,
    plan: dict[str, object],
    state: QualityIterateState,
    *,
    device: str,
) -> Path | None:
    py = python_exe()
    manifest = REPO / "ml/data/manifests/kraken_gt_manifest.jsonl"
    model_dir = REPO / f"ml/models/edison-htr-quality-r{round_id:02d}.mlmodel"
    train_list = REPO / f"ml/data/manifests/confidence_train_r{round_id:02d}.txt"
    arrow_path = REPO / f"ml/data/manifests/edison_recognition_quality_r{round_id:02d}.arrow"

    if not plan.get("skip_upgrade"):
        run(
            [
                py,
                str(SCRIPT_DIR / "upgrade_gt_manifest.py"),
                "--manifest",
                str(manifest),
                "--only-legacy",
                "--demote-low-quality",
                "--resume",
                "--skip-forced-align",
                "--label-provider",
                "auto",
            ],
            "upgrade manifest",
        )

    salvage_limit = int(plan.get("salvage_limit") or 0)
    if salvage_limit > 0:
        run(
            [
                py,
                str(SCRIPT_DIR / "refine_gt_with_vision.py"),
                "--manifest",
                str(manifest),
                "--limit",
                str(salvage_limit),
                "--label-provider",
                "auto",
            ],
            "vision salvage",
        )

    harvest_limit = int(plan.get("harvest_limit") or 0)
    if harvest_limit > 0:
        run(
            [
                py,
                str(SCRIPT_DIR / "build_hybrid_ground_truth.py"),
                "--limit",
                str(harvest_limit),
                "--unprocessed-only",
                "--resume",
                "--skip-forced-align",
                "--label-provider",
                "auto",
                "--device",
                device,
            ],
            "hybrid harvest",
        )

    ocr_limit = int(plan.get("ocr_refine_limit") or 0)
    if ocr_limit > 0:
        refine_model = state.best_safetensors or state.best_checkpoint or str(REPO / "ml/models/en_best.mlmodel")
        run(
            [
                py,
                str(SCRIPT_DIR / "refine_gt_with_ocr.py"),
                "--limit",
                str(ocr_limit),
                "--kraken-model",
                str(refine_model),
                "--require-transcript-type",
                "diplomatic",
            ],
            "ocr refine rejected",
        )

    relabel_limit = int(plan.get("relabel_review_limit") or 0)
    if relabel_limit > 0:
        relabel_review_pages(relabel_limit)

    tier_a_only = bool(plan.get("tier_a_only"))
    max_line_cer = float(plan.get("max_line_cer") or 0.28)
    confidence_args = [
        py,
        str(SCRIPT_DIR / "build_confidence_pagexml.py"),
        "--manifest",
        str(manifest),
        "--page-list",
        str(train_list),
        "--max-line-cer",
        str(max_line_cer),
        "--label-provider",
        "auto",
    ]
    if tier_a_only:
        confidence_args.append("--tier-a-only")
    code = run(confidence_args, "build confidence pagexml")
    if code != 0:
        curation_args = [
            py,
            str(SCRIPT_DIR / "prepare_phase2_training.py"),
            "--manifest",
            str(manifest),
            "--train-list",
            str(train_list),
            "--output",
            str(REPO / f"ml/data/manifests/quality_curation_r{round_id:02d}.jsonl"),
        ]
        if plan.get("include_tier_b"):
            curation_args.append("--include-tier-b")
        run(curation_args, "fallback tier curation")

    if not train_list.exists() or not train_list.read_text(encoding="utf-8").strip():
        log("No training pages for round; skipping train")
        return None

    run(
        [
            py,
            str(SCRIPT_DIR / "compile_kraken_dataset.py"),
            "--page-list",
            str(train_list),
            "--output",
            str(arrow_path),
            "--num-workers",
            "0",
        ],
        "compile arrow",
    )

    init_model = resolve_init_model(state)
    max_epochs = int(plan.get("max_epochs") or 35)
    model_dir.mkdir(parents=True, exist_ok=True)
    run(
        [
            ketos_exe(),
            "--workers",
            "0",
            "train",
            "-f",
            "binary",
            "-i",
            str(init_model),
            "-o",
            str(model_dir),
            "--resize",
            "union",
            str(arrow_path),
            "-N",
            str(max_epochs),
        ],
        "ketos train",
    )
    best_ckpt = find_best_checkpoint(model_dir)
    if best_ckpt:
        safetensors = default_output_path(best_ckpt)
        try:
            export_checkpoint(best_ckpt, safetensors)
            log(f"Exported {safetensors}")
        except Exception as error:
            log(f"Safetensors export failed: {error}")
            safetensors = None
    else:
        safetensors = None
    return best_ckpt


def main() -> int:
    args = parse_args()
    state = load_state(args.state)
    start_round = state.round if args.start_round < 0 else args.start_round

    log(f"Auto-iterate starting at round {start_round} (max {args.max_rounds})")

    if start_round == 0 and pipeline_busy():
        log("Round 0 (overnight) running; waiting for completion before eval")
        wait_for_idle(args.poll_seconds)
        quality_dir = REPO / "ml/models/edison-htr-quality.mlmodel"
        best_ckpt = find_best_checkpoint(quality_dir)
        if best_ckpt:
            safetensors = default_output_path(best_ckpt)
            if not safetensors.exists():
                try:
                    export_checkpoint(best_ckpt, safetensors)
                except Exception as error:
                    log(f"Export failed: {error}")
            metrics = evaluate_model(
                safetensors if safetensors.exists() else best_ckpt,
                0,
            )
            line_acc = float(metrics.get("char_accuracy") or 0.0)
            log(f"Round 0 eval line char accuracy: {line_acc:.1%}")
            state.history.append(
                {
                    "round": 0,
                    "name": "overnight_baseline",
                    "line_char_accuracy": line_acc,
                    "checkpoint": str(best_ckpt),
                }
            )
            if line_acc > state.best_line_char_accuracy:
                state.best_line_char_accuracy = line_acc
                state.best_checkpoint = str(best_ckpt)
                if safetensors.exists():
                    state.best_safetensors = str(safetensors)
            state.round = 1
            save_state(args.state, state)
        start_round = 1

    for round_id in range(start_round, min(args.max_rounds, len(ROUND_PLANS))):
        wait_for_idle(args.poll_seconds)
        plan = ROUND_PLANS[round_id]
        log(f"=== Round {round_id}: {plan.get('name')} ===")

        best_ckpt = execute_round(round_id, plan, state, device=args.device)
        if best_ckpt is None:
            state.round = round_id + 1
            save_state(args.state, state)
            continue

        safetensors = default_output_path(best_ckpt)
        metrics = evaluate_model(safetensors if safetensors.exists() else best_ckpt, round_id)
        line_acc = float(metrics.get("char_accuracy") or 0.0)
        log(f"Round {round_id} test line char accuracy: {line_acc:.1%} ({metrics.get('count')} lines)")

        improved = line_acc > state.best_line_char_accuracy + args.min_improvement
        record = {
            "round": round_id,
            "name": plan.get("name"),
            "line_char_accuracy": line_acc,
            "near_correct_pct": metrics.get("near_correct_pct"),
            "line_count": metrics.get("count"),
            "checkpoint": str(best_ckpt),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        state.history.append(record)

        if improved:
            state.best_line_char_accuracy = line_acc
            state.best_checkpoint = str(best_ckpt)
            if safetensors.exists():
                state.best_safetensors = str(safetensors)
            state.plateau_count = 0
            iterative = REPO / "ml/data/manifests/iterative_train_state.json"
            iterative.write_text(
                json.dumps(
                    {
                        "iteration": round_id + 2,
                        "best_val_accuracy": float(re.search(r"-(\d+\.\d+)\.ckpt$", best_ckpt.name).group(1))
                        if re.search(r"-(\d+\.\d+)\.ckpt$", best_ckpt.name)
                        else line_acc,
                        "best_checkpoint": str(best_ckpt),
                        "best_safetensors": str(safetensors) if safetensors.exists() else "",
                        "target_accuracy": 0.7,
                        "plateau_count": 0,
                        "history": state.history,
                    },
                    indent=2,
                ),
                encoding="utf-8",
            )
        else:
            state.plateau_count += 1

        state.round = round_id + 1
        save_state(args.state, state)

        if line_acc >= args.target_line_accuracy:
            log(f"Target line accuracy {args.target_line_accuracy:.0%} reached")
            break
        if state.plateau_count >= args.plateau_patience:
            log("Plateau reached; stopping auto-iterate")
            break

    log(
        f"Done. Best line accuracy {state.best_line_char_accuracy:.1%} "
        f"checkpoint={state.best_checkpoint or 'none'}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
