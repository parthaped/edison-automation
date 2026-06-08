#!/usr/bin/env python3
"""Compile PAGE XML ground truth into a Kraken Arrow dataset (Windows-safe)."""

from __future__ import annotations

import argparse
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--pagexml-dir",
        type=Path,
        default=Path("ml/data/pagexml"),
        help="Directory containing PAGE XML files.",
    )
    parser.add_argument(
        "--page-list",
        type=Path,
        default=None,
        help="Optional newline-separated PAGE XML paths (overrides --pagexml-dir glob).",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("ml/data/manifests/edison_recognition.arrow"),
    )
    parser.add_argument(
        "--num-workers",
        type=int,
        default=0,
        help="Worker processes for line extraction (0 avoids Windows spawn crashes).",
    )
    return parser.parse_args()


def resolve_page_files(args: argparse.Namespace) -> list[str]:
    if args.page_list:
        paths = []
        for line in args.page_list.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line:
                paths.append(str(Path(line)))
        return sorted(paths)
    return sorted(str(path) for path in args.pagexml_dir.glob("*.xml"))


def main() -> int:
    args = parse_args()
    from kraken.lib import arrow_dataset

    files = resolve_page_files(args)
    if not files:
        raise RuntimeError(f"No PAGE XML files found in {args.pagexml_dir}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    arrow_dataset.build_binary_dataset(
        files=files,
        output_file=str(args.output),
        format_type="page",
        num_workers=args.num_workers,
        force_type=None,
        recordbatch_size=100,
        skip_empty_lines=True,
        callback=lambda _advance, _total: None,
        legacy_polygons=False,
    )
    print(f"Wrote {args.output} from {len(files)} PAGE XML files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
