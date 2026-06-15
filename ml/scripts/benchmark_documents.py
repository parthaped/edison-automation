#!/usr/bin/env python3
"""GPU benchmark orchestrator: transcribe corpus pages with Qwen then Gemma."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path
from typing import Protocol

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from corpus_discovery import DocumentBundle, PageJob, discover_documents  # noqa: E402
from log_utils import append_jsonl, log_generation, setup_logger, utc_now_iso  # noqa: E402
from scratch_paths import data_dir, qwen_model_dir, gemma_model_dir, run_dir  # noqa: E402
from transcribe_gemma_vl import GEMMA_IMPORT_ERROR, GemmaVlTranscriber, MODEL_LABEL as GEMMA_LABEL  # noqa: E402
from transcribe_gemma_vl import MODEL_SLUG as GEMMA_SLUG  # noqa: E402
from transcribe_qwen_vl import MODEL_LABEL as QWEN_LABEL  # noqa: E402
from transcribe_qwen_vl import MODEL_SLUG as QWEN_SLUG, QWEN_IMPORT_ERROR, QwenVlTranscriber  # noqa: E402


class PageTranscriber(Protocol):
    def transcribe_page(self, image_path: Path): ...

    def unload(self) -> None: ...


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=None)
    parser.add_argument("--run-dir", type=Path, default=None)
    parser.add_argument(
        "--transcribe-only",
        action="store_true",
        help="Transcribe and log metrics only (default behavior).",
    )
    parser.add_argument(
        "--models",
        choices=("both", "qwen", "gemma"),
        default="both",
        help="Which model passes to run.",
    )
    parser.add_argument("--limit", type=int, default=None, help="Limit total page jobs.")
    parser.add_argument("--max-new-tokens", type=int, default=4096)
    parser.add_argument("--attn-implementation", default=None)
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Do not attempt model downloads when weights are missing.",
    )
    return parser.parse_args()


def verify_gpus(logger) -> None:
    if QWEN_IMPORT_ERROR is not None and GEMMA_IMPORT_ERROR is not None:
        raise RuntimeError("Neither Qwen nor Gemma imports are available in this environment.")
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader"],
            check=True,
            capture_output,
            text=True,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as error:
        raise RuntimeError("nvidia-smi pre-flight failed; run on a GPU node.") from error
    lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    logger.info("GPU pre-flight: %s", lines)
    if len(lines) < 2:
        raise RuntimeError(f"Expected 2 GPUs, found {len(lines)}: {lines}")


def ensure_model(path: Path, downloader: str, skip_download: bool) -> None:
    if path.exists():
        return
    if skip_download:
        raise RuntimeError(f"Model missing at {path} and --skip-download was set.")
    script = SCRIPT_DIR / downloader
    subprocess.run([sys.executable, str(script), "--output", str(path)], check=True)


def page_output_path(run_root: Path, document: str, model_slug: str, page_index: int) -> Path:
    return run_root / document / model_slug / f"page-{page_index}.raw.txt"


def iter_page_jobs(bundles: list[DocumentBundle], limit: int | None) -> list[tuple[DocumentBundle, PageJob]]:
    jobs: list[tuple[DocumentBundle, PageJob]] = []
    for bundle in bundles:
        for page in bundle.pages:
            jobs.append((bundle, page))
            if limit is not None and len(jobs) >= limit:
                return jobs
    return jobs


def run_pass(
    *,
    pass_name: str,
    model_label: str,
    model_slug: str,
    transcriber: PageTranscriber,
    jobs: list[tuple[DocumentBundle, PageJob]],
    run_root: Path,
    jsonl_path: Path,
    logger,
) -> None:
    logger.info("=== %s ===", pass_name)
    try:
        for bundle, page in jobs:
            out_path = page_output_path(run_root, bundle.name, model_slug, page.page_index)
            out_path.parent.mkdir(parents=True, exist_ok=True)

            lines, raw, metrics = transcriber.transcribe_page(page.image_path)
            out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

            record = {
                "timestamp": utc_now_iso(),
                "model": model_label,
                "document": bundle.name,
                "page": page.page_name,
                "page_index": page.page_index,
                "input_tokens": metrics.input_tokens,
                "output_tokens": metrics.output_tokens,
                "elapsed_sec": metrics.elapsed_sec,
                "tokens_per_min": metrics.tokens_per_min,
                "paths": {"raw": str(out_path.resolve())},
            }
            append_jsonl(jsonl_path, record)
            log_generation(logger, record)
    finally:
        transcriber.unload()
        logger.info("Unloaded %s", pass_name)


def main() -> int:
    args = parse_args()
    corpus_dir = args.data_dir or data_dir()
    output_root = args.run_dir or run_dir()
    output_root.mkdir(parents=True, exist_ok=True)
    jsonl_path = output_root / "generations.jsonl"

    logger = setup_logger("benchmark_documents")
    logger.info("data_dir=%s run_dir=%s", corpus_dir, output_root)

    verify_gpus(logger)
    bundles = discover_documents(corpus_dir)
    if not bundles:
        raise RuntimeError(f"No documents discovered under {corpus_dir}")
    jobs = iter_page_jobs(bundles, args.limit)
    logger.info("Discovered %d documents, %d page jobs", len(bundles), len(jobs))

    if args.models in ("both", "qwen"):
        qwen_path = qwen_model_dir()
        ensure_model(qwen_path, "download_qwen_vl.py", args.skip_download)
        qwen = QwenVlTranscriber(
            model_dir=qwen_path,
            max_new_tokens=args.max_new_tokens,
            attn_implementation=args.attn_implementation,
        )
        run_pass(
            pass_name="PASS 1: Qwen3-VL-30B",
            model_label=QWEN_LABEL,
            model_slug=QWEN_SLUG,
            transcriber=qwen,
            jobs=jobs,
            run_root=output_root,
            jsonl_path=jsonl_path,
            logger=logger,
        )

    if args.models in ("both", "gemma"):
        gemma_path = gemma_model_dir()
        ensure_model(gemma_path, "download_gemma_vl.py", args.skip_download)
        gemma = GemmaVlTranscriber(
            model_dir=gemma_path,
            max_new_tokens=args.max_new_tokens,
            attn_implementation=args.attn_implementation,
        )
        run_pass(
            pass_name="PASS 2: Gemma-4-26B",
            model_label=GEMMA_LABEL,
            model_slug=GEMMA_SLUG,
            transcriber=gemma,
            jobs=jobs,
            run_root=output_root,
            jsonl_path=jsonl_path,
            logger=logger,
        )

    logger.info("Transcription complete. generations.jsonl -> %s", jsonl_path)
    logger.info("Next: run compare_run_results.py on the login node.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
