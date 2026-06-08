#!/usr/bin/env python3
"""Re-process rejected GT pages with OCR-assisted alignment using the current best model."""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_kraken_ground_truth import (  # noqa: E402
    append_jsonl,
    image_path_for,
    pagexml_path_for,
)
from kraken_gt.kraken_align import KrakenRuntime  # noqa: E402
from kraken_gt.ocr_refine import OcrRefineConfig, process_page_ocr_assisted  # noqa: E402
from kraken_gt.transcript_validate import classify_transcript  # noqa: E402
from rutgers_omeka import OmekaClient, TranscribedPage, classify_split  # noqa: E402


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
    parser.add_argument("--cache-dir", type=Path, default=Path("ml/data/cache/omeka"))
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--precision", default="bf16-mixed")
    parser.add_argument("--limit", type=int, default=150)
    parser.add_argument(
        "--reasons",
        default="match_ratio_below_threshold,median_cer_above_threshold,no_validated_line_matches",
        help="Comma-separated review reasons eligible for OCR refine.",
    )
    parser.add_argument(
        "--require-transcript-type",
        default="diplomatic",
        help="Only refine pages whose Scripto text classifies as this type (empty = no filter).",
    )
    return parser.parse_args()


def load_review_rows(path: Path, allowed_reasons: set[str]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    seen: set[str] = set()
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            row = json.loads(line)
            page_id = str(row.get("id", ""))
            if page_id in seen:
                continue
            reason = str(row.get("reason", ""))
            if reason not in allowed_reasons:
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
        except RuntimeError as error:
            if attempt + 1 >= retries:
                print(f"  fetch failed after {retries} attempts ({error})")
                return None
            delay = min(2 ** attempt, 30)
            print(f"  fetch retry {attempt + 1}/{retries} in {delay}s ({error})")
            time.sleep(delay)
    return None


def main() -> int:
    args = parse_args()
    allowed = {part.strip() for part in args.reasons.split(",") if part.strip()}
    candidates = load_review_rows(args.review_manifest, allowed)[: args.limit]
    if not candidates:
        print("No review pages eligible for OCR refine.")
        return 0

    client = OmekaClient(cache_dir=args.cache_dir)
    runtime = KrakenRuntime(
        device=args.device,
        batch_size=args.batch_size,
        precision=args.precision,
        recognition_model=args.kraken_model,
    )
    config = OcrRefineConfig()
    accepted = 0
    rejected = 0

    for index, row in enumerate(candidates, start=1):
        media_id = int(row["media_id"])
        page = fetch_page(client, media_id)
        if page is None:
            rejected += 1
            continue
        if args.require_transcript_type:
            validation = classify_transcript(
                page.transcription,
                segmented_lines=int(row.get("segmented_lines") or 0),
            )
            if validation.transcript_type != args.require_transcript_type:
                print(f"[{index}/{len(candidates)}] skip {row.get('id')} (type={validation.transcript_type})")
                continue

        print(f"[{index}/{len(candidates)}] OCR refine {row.get('id')}")
        image_path = image_path_for(page, args.images_dir)
        client.download_binary(page.image_url, image_path)
        xml_path = pagexml_path_for(page, args.pagexml_dir)
        try:
            result = process_page_ocr_assisted(
                image_path=image_path,
                transcription=page.transcription,
                output_path=xml_path,
                pagexml_root=args.pagexml_dir,
                runtime=runtime,
                config=config,
            )
        except Exception as error:
            rejected += 1
            print(f"  rejected ({error})")
            continue

        manifest_row = {
            "id": row.get("id"),
            "document_id": page.document_id,
            "media_id": media_id,
            "image_path": str(image_path).replace("\\", "/"),
            "split": classify_split(page.document_id),
            "status": result.get("status"),
            "label_source": "ocr_assisted",
            "source": "ocr_assisted",
            **{key: result[key] for key in result if key not in {"status"}},
        }
        if result.get("status") == "accepted":
            accepted += 1
            append_jsonl(args.manifest, manifest_row)
            print(f"  accepted ({result.get('validated_lines')} lines, ocr_assist={result.get('ocr_assist_lines')})")
        else:
            rejected += 1
            append_jsonl(args.review_manifest, {**manifest_row, "reason": result.get("reason")})
            print(f"  rejected ({result.get('reason')})")

    print(f"OCR refine done. accepted={accepted} rejected={rejected}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
