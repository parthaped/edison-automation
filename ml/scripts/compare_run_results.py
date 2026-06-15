#!/usr/bin/env python3
"""Login-node runner: score GPU transcription outputs against reference transcripts."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from compare_texts import accuracy_summary, compare_texts, report_to_dict  # noqa: E402
from corpus_discovery import discover_documents  # noqa: E402
from format_transcription import format_for_compare  # noqa: E402
from log_utils import append_jsonl, log_compare_result, setup_logger  # noqa: E402
from scratch_paths import data_dir, run_dir  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-dir", type=Path, default=None)
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--log-file", type=Path, default=None)
    parser.add_argument(
        "--slurm-log",
        type=Path,
        default=None,
        help="Optional SLURM stdout log for cross-checking token counts.",
    )
    return parser.parse_args()


def load_generations(path: Path) -> list[dict]:
    if not path.exists():
        raise RuntimeError(f"Missing generations.jsonl: {path}")
    records: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            records.append(json.loads(line))
    return records


def reference_map(data_root: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    for bundle in discover_documents(data_root):
        mapping[bundle.name] = bundle.reference_path.read_text(encoding="utf-8")
    return mapping


def slurm_token_counts(slurm_log: Path) -> dict[tuple[str, str, str], dict[str, float | int]]:
    if not slurm_log.exists():
        return {}
    pattern = re.compile(
        r"model=(?P<model>\S+) document=(?P<document>.+?) page=(?P<page>\S+) "
        r"in_tokens=(?P<in_tokens>\d+) out_tokens=(?P<out_tokens>\d+) "
        r"elapsed_sec=(?P<elapsed>[0-9.]+) tokens_per_min=(?P<tpm>[0-9.]+)"
    )
    counts: dict[tuple[str, str, str], dict[str, float | int]] = {}
    for line in slurm_log.read_text(encoding="utf-8", errors="replace").splitlines():
        match = pattern.search(line)
        if not match:
            continue
        key = (match.group("model"), match.group("document"), match.group("page"))
        counts[key] = {
            "input_tokens": int(match.group("in_tokens")),
            "output_tokens": int(match.group("out_tokens")),
            "elapsed_sec": float(match.group("elapsed")),
            "tokens_per_min": float(match.group("tpm")),
        }
    return counts


def model_slug_from_label(model_label: str) -> str:
    if "qwen" in model_label:
        return "qwen3-vl-30b"
    if "gemma" in model_label:
        return "gemma-4-26b"
    return model_label.replace("/", "-")


def main() -> int:
    args = parse_args()
    run_root = args.run_dir or run_dir()
    data_root = args.data_dir or data_dir()
    log_path = args.log_file or (run_root / "compare.log")

    logger = setup_logger("compare_run_results", log_path)
    logger.info("run_dir=%s data_dir=%s", run_root, data_root)

    refs = reference_map(data_root)
    generations = load_generations(run_root / "generations.jsonl")
    slurm_counts = slurm_token_counts(args.slurm_log) if args.slurm_log else {}

    compare_jsonl = run_root / "compare_results.jsonl"
    if compare_jsonl.exists():
        compare_jsonl.unlink()

    aggregate: dict[str, list[float]] = defaultdict(list)
    doc_aggregate: dict[tuple[str, str], list[float]] = defaultdict(list)

    for record in generations:
        document = str(record["document"])
        page_name = str(record["page"])
        model = str(record["model"])
        page_index = int(record.get("page_index", 0))

        raw_path = Path(record["paths"]["raw"])
        if not raw_path.exists():
            logger.error("Missing raw transcription: %s", raw_path)
            continue

        reference_raw = refs.get(document)
        if reference_raw is None:
            logger.error("Missing reference transcript for document: %s", document)
            continue

        hyp_formatted = format_for_compare(raw_path.read_text(encoding="utf-8"))
        ref_formatted = format_for_compare(reference_raw)

        model_slug = model_slug_from_label(model)
        formatted_path = run_root / document / model_slug / f"page-{page_index}.formatted.txt"
        compare_path = run_root / document / model_slug / f"page-{page_index}.compare.json"
        formatted_path.parent.mkdir(parents=True, exist_ok=True)
        formatted_path.write_text(hyp_formatted + "\n", encoding="utf-8")

        report = compare_texts(ref_formatted, hyp_formatted)
        accuracy = accuracy_summary(report)
        compare_payload = report_to_dict(report)
        compare_path.write_text(json.dumps(compare_payload, indent=2), encoding="utf-8")

        merged = {
            **record,
            "accuracy": accuracy,
            "paths": {
                **record.get("paths", {}),
                "formatted": str(formatted_path.resolve()),
                "compare_json": str(compare_path.resolve()),
            },
        }

        slurm_key = (model, document, page_name)
        if slurm_key in slurm_counts:
            merged["slurm_log_tokens"] = slurm_counts[slurm_key]

        append_jsonl(compare_jsonl, merged)
        log_compare_result(logger, merged)

        aggregate[model].append(accuracy["character"])
        doc_aggregate[(model, document)].append(accuracy["character"])

    summary = {
        "models": {},
        "documents": {},
    }
    for model, scores in aggregate.items():
        summary["models"][model] = {
            "character_accuracy_avg": round(sum(scores) / len(scores), 4) if scores else 0.0,
            "pages_scored": len(scores),
        }
    for (model, document), scores in doc_aggregate.items():
        summary["documents"].setdefault(document, {})[model] = {
            "character_accuracy_avg": round(sum(scores) / len(scores), 4) if scores else 0.0,
            "pages_scored": len(scores),
        }

    summary_path = run_root / "compare_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    logger.info("Wrote %s and %s", compare_jsonl, summary_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
