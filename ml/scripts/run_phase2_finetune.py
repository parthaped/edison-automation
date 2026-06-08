#!/usr/bin/env python3
"""Wait for the 500-page GT build, then run phase-2 curation and fine-tuning."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path("ml/data/manifests/kraken_gt_checkpoint.json"),
    )
    parser.add_argument("--poll-seconds", type=int, default=60)
    parser.add_argument("--skip-wait", action="store_true")
    return parser.parse_args()


def processed_count(checkpoint: Path) -> int:
    if not checkpoint.exists():
        return 0
    data = json.loads(checkpoint.read_text(encoding="utf-8"))
    return len(data.get("processed_media_ids") or [])


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]

    if not args.skip_wait:
        print(f"Waiting for GT build to reach {args.limit} processed pages...", file=sys.stderr)
        while True:
            count = processed_count(args.checkpoint)
            print(f"  processed={count}/{args.limit}", file=sys.stderr)
            if count >= args.limit:
                break
            time.sleep(max(args.poll_seconds, 5))

    script = repo_root / "ml" / "scripts" / "train_phase2_kraken.ps1"
    result = subprocess.run(
        ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(script)],
        cwd=repo_root,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
