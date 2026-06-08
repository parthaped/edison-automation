#!/usr/bin/env python3
"""Post-train guardrail: prevent holdout degradation when training plateaus."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO = SCRIPT_DIR.parents[1]

DEFAULT_GOAL_STATE = REPO / "ml/data/manifests/kraken_ocr_goal_state.json"
DEFAULT_FROZEN_MANIFEST = REPO / "ml/data/manifests/line_crops_frozen52.jsonl"
DEFAULT_PAGE_LIST = REPO / "ml/data/manifests/frozen_test_52_pagexml.txt"
DEFAULT_MANIFEST = REPO / "ml/data/manifests/kraken_gt_manifest.pre_upgrade.jsonl"


@dataclass
class GuardrailDecision:
    action: str  # promote | rollback
    reason: str
    baseline_holdout: float
    candidate_holdout: float
    holdout_delta: float
    target_holdout: float | None
    training_plateaued: bool
    init_val_accuracy: float | None
    candidate_val_accuracy: float | None
    promoted_checkpoint: str
    promoted_safetensors: str
    timestamp: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--init-checkpoint", type=Path, required=True)
    parser.add_argument("--train-log", type=Path, default=REPO / "ml/reports/gemini_v5_train.log")
    parser.add_argument(
        "--frozen-manifest",
        type=Path,
        default=DEFAULT_FROZEN_MANIFEST,
        help="Line-crop manifest for frozen holdout benchmark.",
    )
    parser.add_argument("--page-list", type=Path, default=DEFAULT_PAGE_LIST)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument(
        "--benchmark-output",
        type=Path,
        help="Where to write holdout predictions for the promoted model.",
    )
    parser.add_argument(
        "--goal-state",
        type=Path,
        default=DEFAULT_GOAL_STATE,
        help="Goal state JSON; baseline holdout read/updated here.",
    )
    parser.add_argument(
        "--baseline-holdout",
        type=float,
        help="Fallback baseline when init benchmark is skipped (0-1). Not used for rollback when init is benchmarked.",
    )
    parser.add_argument(
        "--target-holdout",
        type=float,
        help="Aspirational holdout target for reporting only (does not trigger rollback).",
    )
    parser.add_argument(
        "--max-degradation",
        type=float,
        default=0.005,
        help="Max allowed holdout drop vs baseline before rollback (default 0.5%%).",
    )
    parser.add_argument(
        "--min-improvement",
        type=float,
        default=0.002,
        help="Minimum holdout gain required to promote when training plateaued.",
    )
    parser.add_argument(
        "--val-plateau-patience",
        type=int,
        default=3,
        help="Epochs without val improvement to treat training as plateaued.",
    )
    parser.add_argument(
        "--val-min-delta",
        type=float,
        default=0.001,
        help="Minimum val accuracy gain to count as improvement.",
    )
    parser.add_argument(
        "--skip-baseline-benchmark",
        action="store_true",
        help="Use goal-state baseline only; do not benchmark init checkpoint.",
    )
    return parser.parse_args()


def python_exe() -> str:
    venv = REPO / "ml/.venv/Scripts/python.exe"
    return str(venv if venv.exists() else Path(sys.executable))


def run(cmd: list[str], label: str) -> None:
    print(f"[guardrail] {label}: {' '.join(cmd)}", file=sys.stderr)
    result = subprocess.run(cmd, cwd=REPO)
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {result.returncode}")


def checkpoint_val_score(path: Path) -> float | None:
    match = re.search(r"-(\d+\.\d+)\.ckpt$", path.name)
    return float(match.group(1)) if match else None


def find_best_checkpoint(model_dir: Path) -> Path | None:
    best_score = -1.0
    best_path: Path | None = None
    for path in model_dir.glob("checkpoint_*.ckpt"):
        if "abort" in path.name or "guardrail" in path.name:
            continue
        score = checkpoint_val_score(path)
        if score is None:
            continue
        if score > best_score:
            best_score = score
            best_path = path
    return best_path


def export_checkpoint(checkpoint: Path, output: Path | None = None) -> Path:
    cmd = [python_exe(), str(SCRIPT_DIR / "export_kraken_checkpoint.py"), "--checkpoint", str(checkpoint)]
    if output:
        cmd.extend(["--output", str(output)])
    run(cmd, "export checkpoint")
    if output and output.exists():
        return output
    score = checkpoint_val_score(checkpoint)
    score_text = f"{score:.4f}" if score is not None else "0"
    default = checkpoint.parent / f"best_{score_text}.safetensors"
    if not default.exists():
        candidates = sorted(checkpoint.parent.glob("best_*.safetensors"), reverse=True)
        if not candidates:
            raise FileNotFoundError(f"No safetensors exported for {checkpoint}")
        return candidates[0]
    return default


def summarize_benchmark(path: Path) -> dict[str, float | int]:
    if not path.exists():
        return {"count": 0, "char_accuracy": 0.0}
    cers: list[float] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            cers.append(float(json.loads(line).get("cer", 1.0)))
    if not cers:
        return {"count": 0, "char_accuracy": 0.0}
    avg_cer = sum(cers) / len(cers)
    return {"count": len(cers), "char_accuracy": round((1.0 - avg_cer) * 10000) / 10000}


def ensure_frozen_manifest(
    frozen_manifest: Path,
    page_list: Path,
    manifest: Path,
) -> None:
    if frozen_manifest.exists():
        return
    run(
        [
            python_exe(),
            str(SCRIPT_DIR / "export_lines_from_pagexml.py"),
            "--page-list",
            str(page_list),
            "--manifest",
            str(manifest),
            "--output",
            str(frozen_manifest),
            "--crop",
        ],
        "export frozen holdout line crops",
    )


def benchmark_model(
    model_path: Path,
    output: Path,
    *,
    frozen_manifest: Path,
    page_list: Path,
    manifest: Path,
) -> dict[str, float | int]:
    ensure_frozen_manifest(frozen_manifest, page_list, manifest)
    output.parent.mkdir(parents=True, exist_ok=True)
    run(
        [
            python_exe(),
            str(SCRIPT_DIR / "benchmark_models.py"),
            "--manifest",
            str(frozen_manifest),
            "--split",
            "all",
            "--models",
            "kraken",
            "--kraken-model",
            str(model_path),
            "--kraken-mode",
            "recognition",
            "--output",
            str(output),
        ],
        f"benchmark {model_path.name}",
    )
    return summarize_benchmark(output)


def resolve_init_weights(init_checkpoint: Path) -> Path:
    if init_checkpoint.suffix == ".safetensors" and init_checkpoint.exists():
        return init_checkpoint
    sibling = sorted(init_checkpoint.parent.glob("best_*.safetensors"), reverse=True)
    if sibling:
        return sibling[0]
    return export_checkpoint(init_checkpoint)


def snapshot_init(init_checkpoint: Path, model_dir: Path) -> Path:
    model_dir.mkdir(parents=True, exist_ok=True)
    snapshot = model_dir / "guardrail_init.ckpt"
    if not init_checkpoint.exists():
        raise FileNotFoundError(init_checkpoint)
    shutil.copy2(init_checkpoint, snapshot)
    return snapshot


def parse_training_plateau(
    train_log: Path,
    *,
    patience: int,
    min_delta: float,
) -> tuple[bool, float | None, list[float]]:
    if not train_log.exists():
        return False, None, []

    epoch_vals: list[float] = []
    for line in train_log.read_text(encoding="utf-8", errors="replace").splitlines():
        match = re.search(r"\b(\d+)/\d+\s+([\d.]+)\s*$", line)
        if match:
            epoch_vals.append(float(match.group(2)))
        match = re.search(
            r"checkpoint_\d+-(\d+\.\d+)\.ckpt \(score: (\d+\.\d+)\)",
            line,
        )
        if match:
            epoch_vals.append(float(match.group(2)))

    if not epoch_vals:
        return False, None, epoch_vals

    best = epoch_vals[0]
    plateau_epochs = 0
    for value in epoch_vals[1:]:
        if value > best + min_delta:
            best = value
            plateau_epochs = 0
        else:
            plateau_epochs += 1

    plateaued = plateau_epochs >= patience
    return plateaued, best, epoch_vals


def load_goal_baseline(goal_state_path: Path) -> float | None:
    if not goal_state_path.exists():
        return None
    data = json.loads(goal_state_path.read_text(encoding="utf-8"))
    for key in ("target_holdout_line_char_acc", "baseline_holdout_line_char_acc"):
        value = data.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return float(value)
    return None


def update_goal_state(goal_state_path: Path, decision: GuardrailDecision) -> None:
    data: dict = {}
    if goal_state_path.exists():
        data = json.loads(goal_state_path.read_text(encoding="utf-8"))

    current_best = float(data.get("baseline_holdout_line_char_acc") or 0.0)
    if decision.action == "promote":
        data["baseline_holdout_line_char_acc"] = max(current_best, decision.candidate_holdout)
        data["current_best_model"] = decision.promoted_safetensors.replace("\\", "/")
        data["status"] = "guardrail_promoted"
    else:
        data["status"] = "guardrail_rollback"
        data["last_rejected_holdout"] = decision.candidate_holdout

    data["last_guardrail"] = asdict(decision)
    data["updated_at"] = decision.timestamp
    goal_state_path.parent.mkdir(parents=True, exist_ok=True)
    goal_state_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def decide(
    *,
    baseline_holdout: float,
    candidate_holdout: float,
    training_plateaued: bool,
    max_degradation: float,
    min_improvement: float,
) -> tuple[str, str]:
    delta = candidate_holdout - baseline_holdout

    if candidate_holdout < baseline_holdout - max_degradation:
        return (
            "rollback",
            f"holdout degraded by {abs(delta):.2%} (>{max_degradation:.2%} tolerance)",
        )

    if training_plateaued and delta < min_improvement:
        return (
            "rollback",
            f"training plateaued without holdout gain ({delta:+.2%} < {min_improvement:.2%})",
        )

    if delta < 0:
        return (
            "rollback",
            f"holdout below baseline ({candidate_holdout:.2%} < {baseline_holdout:.2%})",
        )

    return ("promote", f"holdout improved or held ({delta:+.2%} vs baseline)")


def apply_rollback(snapshot_ckpt: Path, model_dir: Path) -> tuple[Path, Path]:
    restored = model_dir / "checkpoint_guardrail_restored.ckpt"
    shutil.copy2(snapshot_ckpt, restored)
    promoted = model_dir / "promoted_guardrail.safetensors"
    safetensors = export_checkpoint(restored, promoted)
    marker = model_dir / "GUARDRAIL_ROLLBACK"
    marker.write_text(
        f"Rolled back to init snapshot at {datetime.now(timezone.utc).isoformat()}\n",
        encoding="utf-8",
    )
    return restored, safetensors


def apply_promote(candidate_ckpt: Path, model_dir: Path) -> tuple[Path, Path]:
    promoted = model_dir / "promoted_guardrail.safetensors"
    safetensors = export_checkpoint(candidate_ckpt, promoted)
    marker = model_dir / "GUARDRAIL_PROMOTED"
    marker.write_text(
        f"Promoted {candidate_ckpt.name} at {datetime.now(timezone.utc).isoformat()}\n",
        encoding="utf-8",
    )
    if marker.with_name("GUARDRAIL_ROLLBACK").exists():
        marker.with_name("GUARDRAIL_ROLLBACK").unlink()
    return candidate_ckpt, safetensors


def main() -> int:
    args = parse_args()
    bench_kwargs = {
        "frozen_manifest": args.frozen_manifest,
        "page_list": args.page_list,
        "manifest": args.manifest,
    }

    model_dir = args.model_dir.resolve()
    init_checkpoint = args.init_checkpoint.resolve()
    if not init_checkpoint.exists():
        print(f"Init checkpoint missing: {init_checkpoint}", file=sys.stderr)
        return 1

    snapshot = snapshot_init(init_checkpoint, model_dir)
    init_val = checkpoint_val_score(init_checkpoint)

    fallback_baseline = args.baseline_holdout
    if fallback_baseline is None:
        fallback_baseline = load_goal_baseline(args.goal_state)

    init_weights = resolve_init_weights(init_checkpoint)
    baseline_benchmark_path = REPO / "ml/reports/guardrail_baseline_frozen52.jsonl"
    measured_baseline: float | None = None
    if not args.skip_baseline_benchmark:
        init_metrics = benchmark_model(init_weights, baseline_benchmark_path, **bench_kwargs)
        measured_baseline = float(init_metrics["char_accuracy"])
        print(
            f"[guardrail] init holdout: {measured_baseline:.2%} "
            f"({init_metrics['count']} lines)",
            file=sys.stderr,
        )

    baseline_holdout = measured_baseline if measured_baseline is not None else fallback_baseline
    if baseline_holdout is None:
        baseline_holdout = 0.0
        print("[guardrail] warning: no baseline holdout; using 0%", file=sys.stderr)

    candidate_ckpt = find_best_checkpoint(model_dir)
    if candidate_ckpt is None:
        print("[guardrail] no candidate checkpoint; keeping init snapshot", file=sys.stderr)
        candidate_ckpt = snapshot

    candidate_val = checkpoint_val_score(candidate_ckpt)
    candidate_weights = export_checkpoint(candidate_ckpt)
    candidate_benchmark_path = args.benchmark_output or (
        REPO / "ml/reports/guardrail_candidate_frozen52.jsonl"
    )
    candidate_metrics = benchmark_model(candidate_weights, candidate_benchmark_path, **bench_kwargs)
    candidate_holdout = float(candidate_metrics["char_accuracy"])

    training_plateaued, _, _ = parse_training_plateau(
        args.train_log,
        patience=args.val_plateau_patience,
        min_delta=args.val_min_delta,
    )

    action, reason = decide(
        baseline_holdout=baseline_holdout,
        candidate_holdout=candidate_holdout,
        training_plateaued=training_plateaued,
        max_degradation=args.max_degradation,
        min_improvement=args.min_improvement,
    )

    if action == "rollback":
        promoted_ckpt, promoted_safetensors = apply_rollback(snapshot, model_dir)
        final_benchmark_path = args.benchmark_output or (
            REPO / "ml/reports/guardrail_promoted_frozen52.jsonl"
        )
        benchmark_model(promoted_safetensors, final_benchmark_path, **bench_kwargs)
    else:
        promoted_ckpt, promoted_safetensors = apply_promote(candidate_ckpt, model_dir)
        final_benchmark_path = candidate_benchmark_path

    decision = GuardrailDecision(
        action=action,
        reason=reason,
        baseline_holdout=baseline_holdout,
        candidate_holdout=candidate_holdout,
        holdout_delta=candidate_holdout - baseline_holdout,
        target_holdout=args.target_holdout,
        training_plateaued=training_plateaued,
        init_val_accuracy=init_val,
        candidate_val_accuracy=candidate_val,
        promoted_checkpoint=str(promoted_ckpt).replace("\\", "/"),
        promoted_safetensors=str(promoted_safetensors).replace("\\", "/"),
        timestamp=datetime.now(timezone.utc).isoformat(),
    )

    report_path = model_dir / "guardrail_report.json"
    report_path.write_text(json.dumps(asdict(decision), indent=2), encoding="utf-8")
    update_goal_state(args.goal_state, decision)

    print(
        f"[guardrail] {action.upper()}: {reason}\n"
        f"  baseline holdout: {baseline_holdout:.2%}\n"
        f"  candidate holdout: {candidate_holdout:.2%}\n"
        f"  promoted: {promoted_safetensors}",
        file=sys.stderr,
    )
    return 0 if action == "promote" else 2


if __name__ == "__main__":
    raise SystemExit(main())
