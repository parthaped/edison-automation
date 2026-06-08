#!/usr/bin/env python3
"""Salvage rejected GT pages with vision-primary labels (Gemini or local fallback).

Targets diplomatic Scripto pages rejected for alignment failures — the main pool
of ~400+ pages that pure Scripto alignment cannot accept but vision-OCR may rescue.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_hybrid_ground_truth import process_hybrid_page  # noqa: E402
from build_kraken_ground_truth import append_jsonl  # noqa: E402
from kraken_gt.kraken_align import KrakenRuntime  # noqa: E402
from kraken_gt.transcript_validate import classify_transcript  # noqa: E402
from label_provider import resolve_label_provider  # noqa: E402
from rutgers_omeka import OmekaClient, TranscribedPage  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--review-manifest",
        type=Path,
        default=Path("ml/data/manifests/kraken_gt_review.jsonl"),
    )
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument("--pagexml-dir", type=Path, default=Path("ml/data/pagexml"))
    parser.add_argument("--images-dir", type=Path, default=Path("ml/data/raw"))
    parser.add_argument("--scripto-dir", type=Path, default=Path("ml/data/transcripts/scripto"))
    parser.add_argument("--vision-cache-dir", type=Path, default=Path("ml/data/cache/vision_labels"))
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--label-provider", default="auto", dest="label_provider")
    parser.add_argument("--limit", type=int, default=200)
    parser.add_argument(
        "--reasons",
        default="match_ratio_below_threshold,median_cer_above_threshold,too_few_validated_lines",
        help="Comma-separated review reasons eligible for vision salvage.",
    )
    parser.add_argument(
        "--reason-prefix",
        default="",
        help="Also accept review reasons starting with this prefix (e.g. upgrade_qc:).",
    )
    parser.add_argument(
        "--require-transcript-type",
        default="diplomatic",
        help="Only salvage pages whose Scripto classifies as this type (empty = no filter).",
    )
    parser.add_argument("--delay-seconds", type=float, default=0.5)
    return parser.parse_args()


def load_candidates(
    path: Path,
    allowed_reasons: set[str],
    reason_prefix: str = "",
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    seen: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            page_id = str(row.get("id", ""))
            if not page_id or page_id in seen:
                continue
            reason = str(row.get("reason", ""))
            if reason.startswith("error:"):
                continue
            if reason not in allowed_reasons and not (reason_prefix and reason.startswith(reason_prefix)):
                continue
            seen.add(page_id)
            rows.append(row)
    return rows


def fetch_page(client: OmekaClient, media_id: int, retries: int = 5) -> TranscribedPage | None:
    url = f"https://edisondigital.rutgers.edu/api/media/{media_id}"
    for attempt in range(retries):
        try:
            record = client.fetch_json(url)
            return client.parse_media_record(record)
        except Exception:
            if attempt + 1 >= retries:
                return None
            time.sleep(1.5 * (attempt + 1))
    return None


def main() -> int:
    args = parse_args()
    allowed = {part.strip() for part in args.reasons.split(",") if part.strip()}
    candidates = load_candidates(args.review_manifest, allowed, args.reason_prefix)[: args.limit]
    if not candidates:
        print("No eligible rejected pages for vision salvage.")
        return 0

    client = OmekaClient(cache_dir=Path("ml/data/cache/omeka"), delay_seconds=args.delay_seconds)
    vision_provider = resolve_label_provider(args.label_provider, device=args.device)
    segment_runtime = KrakenRuntime(device=args.device, recognition_model=args.kraken_model)
    hybrid_args = argparse.Namespace(
        images_dir=args.images_dir,
        scripto_dir=args.scripto_dir,
        output_dir=args.pagexml_dir,
        vision_cache_dir=args.vision_cache_dir,
        skip_forced_align=False,
    )

    print(f"Vision salvage provider: {vision_provider.name}")
    print(f"Candidates: {len(candidates)}")

    accepted = rejected = skipped = 0
    for index, row in enumerate(candidates, start=1):
        page_id = str(row.get("id", ""))
        media_id = int(row.get("media_id") or 0)
        if not media_id:
            skipped += 1
            continue

        page = fetch_page(client, media_id)
        if page is None:
            skipped += 1
            print(f"[{index}/{len(candidates)}] {page_id} fetch failed")
            continue

        if args.require_transcript_type:
            validation = classify_transcript(page.transcription)
            if validation.transcript_type != args.require_transcript_type:
                skipped += 1
                print(f"[{index}/{len(candidates)}] {page_id} skip ({validation.transcript_type})")
                continue

        print(f"[{index}/{len(candidates)}] {page_id}")
        try:
            result = process_hybrid_page(page, client, segment_runtime, vision_provider, hybrid_args)
        except Exception as error:
            rejected += 1
            append_jsonl(args.review_manifest, {**row, "status": "rejected", "reason": f"vision_salvage_error:{error}"})
            print(f"  rejected ({error})")
            continue

        if result.get("status") == "accepted" and str(result.get("label_source", "")).startswith(
            ("vision", "scripto_vision")
        ):
            accepted += 1
            append_jsonl(args.manifest, result)
            print(
                f"  accepted ({result.get('validated_lines')} lines, "
                f"source={result.get('label_source')})"
            )
        elif result.get("status") == "accepted":
            rejected += 1
            append_jsonl(
                args.review_manifest,
                {**row, **result, "reason": "vision_salvage_still_scripto_only"},
            )
            print(f"  rejected (still scripto-only, ratio={result.get('match_ratio')})")
        else:
            rejected += 1
            append_jsonl(args.review_manifest, {**row, **result})
            print(f"  rejected ({result.get('reason')})")

    print(f"Done. accepted={accepted} rejected={rejected} skipped={skipped}")
    return 0 if accepted > 0 or skipped > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
