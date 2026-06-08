#!/usr/bin/env python3
"""Download a baseline Kraken recognition model into ml/models/."""

from __future__ import annotations

import argparse
import urllib.request
from pathlib import Path


# CATMuS Print Large — English-capable baseline until en_best is fetched via `kraken get`.
DEFAULT_URL = (
    "https://zenodo.org/api/records/10592716/files/catmus-print-fondue-large.mlmodel/content"
)
DEFAULT_NAME = "en_best.mlmodel"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument(
        "--alias",
        default="",
        help="Optional second filename to copy the downloaded weights to.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(args.url, headers={"User-Agent": "edison-automation/0.1"})
    with urllib.request.urlopen(request, timeout=300) as response:
        payload = response.read()
    args.output.write_bytes(payload)
    print(f"Wrote {len(payload)} bytes to {args.output}")
    if args.alias:
        alias_path = args.output.parent / args.alias
        alias_path.write_bytes(payload)
        print(f"Copied to {alias_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
