#!/usr/bin/env python3
"""Standalone PaddleOCR-VL-1.6 doc parser for local Edison PDF/image trials."""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from paddleocr_vl_lib import create_runtime, markdown_from_result  # noqa: E402

DEFAULT_OUTPUT_DIR = Path("ml/reports/paddleocr_vl")


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(REPO_ROOT)).replace("\\", "/")
    except ValueError:
        return str(path).replace("\\", "/")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, required=True, help="PDF or image file.")
    parser.add_argument("--output-dir", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--device", default=None, help="gpu:0, cpu, etc.; auto-detect by default.")
    parser.add_argument(
        "--pipeline-version",
        default="v1.6",
        choices=("v1", "v1.5", "v1.6"),
        help="PaddleOCR-VL pipeline version.",
    )
    parser.add_argument(
        "--concatenate-pages",
        action="store_true",
        default=True,
        help="Merge multi-page PDF output into one markdown/text file (default: on).",
    )
    parser.add_argument(
        "--no-concatenate-pages",
        action="store_false",
        dest="concatenate_pages",
        help="Keep one markdown file per PDF page.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    input_path = args.input if args.input.is_absolute() else REPO_ROOT / args.input
    if not input_path.exists():
        raise SystemExit(f"Input not found: {input_path}")

    output_root = args.output_dir if args.output_dir.is_absolute() else REPO_ROOT / args.output_dir
    job_dir = output_root / input_path.stem
    job_dir.mkdir(parents=True, exist_ok=True)

    print(f"Loading PaddleOCR-VL ({args.pipeline_version})...", flush=True)
    runtime = create_runtime(pipeline_version=args.pipeline_version, device=args.device)

    print(f"Parsing {display_path(input_path)} ...", flush=True)
    started = time.perf_counter()
    pages_res = list(runtime.pipeline.predict(input=str(input_path)))
    elapsed = time.perf_counter() - started

    results = pages_res
    if args.concatenate_pages and len(pages_res) > 1:
        results = runtime.pipeline.restructure_pages(pages_res, concatenate_pages=True)

    markdown_parts: list[str] = []
    for result in results:
        result.save_to_json(save_path=str(job_dir))
        result.save_to_markdown(save_path=str(job_dir))
        page_md = markdown_from_result(result)
        if page_md:
            markdown_parts.append(page_md)

    if not markdown_parts:
        saved_md = sorted(job_dir.glob("*.md"))
        saved_md = [path for path in saved_md if not path.name.endswith(".paddleocr_vl.md")]
        markdown_parts = [
            path.read_text(encoding="utf-8").strip()
            for path in saved_md
            if path.read_text(encoding="utf-8").strip()
        ]

    combined = "\n\n".join(markdown_parts).strip()
    combined_path = job_dir / f"{input_path.stem}.paddleocr_vl.md"
    text_path = job_dir / f"{input_path.stem}.paddleocr_vl.txt"
    combined_path.write_text(combined + ("\n" if combined else ""), encoding="utf-8")
    text_path.write_text(combined + ("\n" if combined else ""), encoding="utf-8")

    print(f"Pages processed: {len(pages_res)}", flush=True)
    print(f"Elapsed: {elapsed:.1f}s", flush=True)
    print(f"Markdown: {display_path(combined_path)}", flush=True)
    print(f"Text: {display_path(text_path)}", flush=True)
    print("", flush=True)
    print(combined or "(no markdown text extracted)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
