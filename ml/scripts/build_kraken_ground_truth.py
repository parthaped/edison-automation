#!/usr/bin/env python3
"""Build Kraken PAGE XML ground truth from Edison Digital Scripto transcriptions.

Discovers page-level transcriptions via the Omeka API, aligns Scripto text to
Kraken-segmented baselines, and writes PAGE XML for train_kraken.ps1.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from kraken_gt.kraken_align import KrakenRuntime  # noqa: E402
from kraken_gt.line_match import sequence_align_lines, match_statistics  # noqa: E402
from kraken_gt.pagexml import write_pagexml  # noqa: E402
from kraken_gt.regions import classify_matched_line  # noqa: E402
from kraken_gt.scripto import parse_scripto_transcription, training_lines  # noqa: E402
from kraken_gt.transcript_validate import classify_transcript  # noqa: E402
from rutgers_omeka import (  # noqa: E402
    OmekaClient,
    TranscribedPage,
    classify_split,
    collect_transcribed_pages,
    collect_unprocessed_transcribed_pages,
)


DEFAULT_MIN_MATCH_RATIO = 0.6
DEFAULT_MAX_MEDIAN_CER = 0.45
DEFAULT_MAX_LINE_CER = 0.85


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=500, help="Number of pages to process.")
    parser.add_argument("--output-dir", type=Path, default=Path("ml/data/pagexml"))
    parser.add_argument("--images-dir", type=Path, default=Path("ml/data/raw"))
    parser.add_argument(
        "--scripto-dir",
        type=Path,
        default=Path("ml/data/transcripts/scripto"),
        help="Audit copies of raw Scripto transcriptions.",
    )
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument(
        "--review-manifest",
        type=Path,
        default=Path("ml/data/manifests/kraken_gt_review.jsonl"),
    )
    parser.add_argument("--checkpoint", type=Path, default=Path("ml/data/manifests/kraken_gt_checkpoint.json"))
    parser.add_argument("--cache-dir", type=Path, default=Path("ml/data/cache/omeka"))
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--precision", default="bf16-mixed")
    parser.add_argument("--delay-seconds", type=float, default=0.5)
    parser.add_argument("--shuffle-seed", type=int, default=42)
    parser.add_argument("--min-match-ratio", type=float, default=DEFAULT_MIN_MATCH_RATIO)
    parser.add_argument("--max-median-cer", type=float, default=DEFAULT_MAX_MEDIAN_CER)
    parser.add_argument("--resume", action="store_true", help="Skip media IDs listed in checkpoint.")
    parser.add_argument(
        "--discover-only",
        action="store_true",
        help="Only discover/sample pages and write a discovery manifest.",
    )
    parser.add_argument(
        "--min-training-lines",
        type=int,
        default=4,
        help="Skip pages whose Scripto transcript has fewer trainable lines than this.",
    )
    parser.add_argument(
        "--skip-forced-align",
        action="store_true",
        help="Skip Kraken forced-alignment validation on matched lines.",
    )
    parser.add_argument(
        "--unprocessed-only",
        action="store_true",
        help="Sample only media IDs not listed in the checkpoint (for corpus expansion).",
    )
    return parser.parse_args()


def load_checkpoint(path: Path) -> set[int]:
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    return {int(item) for item in data.get("processed_media_ids", [])}


def save_checkpoint(path: Path, processed_media_ids: set[int]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"processed_media_ids": sorted(processed_media_ids)}
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def append_jsonl(path: Path, row: dict[str, object]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def page_id(page: TranscribedPage) -> str:
    return f"{page.document_id}_{page.page_stem}"


def image_path_for(page: TranscribedPage, images_dir: Path) -> Path:
    return images_dir / page.document_id / f"{page.page_stem}.jpg"


def pagexml_path_for(page: TranscribedPage, output_dir: Path) -> Path:
    return output_dir / f"{page_id(page)}.xml"


def scripto_path_for(page: TranscribedPage, scripto_dir: Path) -> Path:
    return scripto_dir / page.document_id / f"{page.page_stem}.txt"


def process_page(
    page: TranscribedPage,
    client: OmekaClient,
    runtime: KrakenRuntime,
    args: argparse.Namespace,
) -> dict[str, object]:
    image_path = image_path_for(page, args.images_dir)
    client.download_binary(page.image_url, image_path)

    scripto_copy = scripto_path_for(page, args.scripto_dir)
    if not scripto_copy.exists():
        scripto_copy.parent.mkdir(parents=True, exist_ok=True)
        scripto_copy.write_text(page.transcription.rstrip() + "\n", encoding="utf-8")

    parsed = parse_scripto_transcription(page.transcription)
    references = training_lines(parsed)
    reference_texts = [line.text for line in references]

    segmented, image_size = runtime.segmented_lines_with_ocr(image_path)
    pre_validation = classify_transcript(page.transcription, segmented_lines=len(segmented))
    if pre_validation.transcript_type == "summary":
        return {
            "id": page_id(page),
            "document_id": page.document_id,
            "media_id": page.media_id,
            "status": "rejected",
            "reason": "transcript_summary",
            "transcript_type": "summary",
            "transcript_reasons": pre_validation.reasons,
            "training_lines": len(reference_texts),
            "segmented_lines": len(segmented),
        }
    matches = sequence_align_lines(reference_texts, segmented, max_pair_cer=DEFAULT_MAX_LINE_CER)
    stats = match_statistics(len(reference_texts), len(segmented), matches)

    parsed_by_training_index = {idx: line for idx, line in enumerate(references)}
    classified = []
    validated_matches = 0
    for match in matches:
        parsed_line = parsed_by_training_index.get(match.scripto_index)
        if parsed_line is None:
            continue
        segment = segmented[match.segment_index]
        if not args.skip_forced_align:
            if not runtime.validate_forced_alignment(image_path, match.reference_text, segment):
                continue
        validated_matches += 1
        classified.append(
            classify_matched_line(
                reference_text=match.reference_text,
                segment=segment,
                parsed=parsed_line,
                page_width=image_size[0],
                page_height=image_size[1],
                match_cer=match.match_cer,
                scripto_index=match.scripto_index,
            )
        )

    stats_after_align = match_statistics(len(reference_texts), len(segmented), matches)
    stats_after_align["validated_lines"] = validated_matches
    if reference_texts:
        stats_after_align["match_ratio"] = validated_matches / len(reference_texts)

    base_row: dict[str, object] = {
        "id": page_id(page),
        "document_id": page.document_id,
        "media_id": page.media_id,
        "document_type": page.document_type,
        "image_path": str(image_path).replace("\\", "/"),
        "scripto_lines": len(parsed),
        "training_lines": len(reference_texts),
        "segmented_lines": len(segmented),
        "matched_lines": stats_after_align["matched_lines"],
        "validated_lines": validated_matches,
        "match_ratio": stats_after_align["match_ratio"],
        "mean_match_cer": stats_after_align["mean_match_cer"],
        "median_match_cer": stats_after_align["median_match_cer"],
        "split": classify_split(page.document_id),
        "quality_flags": [],
    }

    if not classified:
        return {
            **base_row,
            "status": "rejected",
            "reason": "no_validated_line_matches",
        }

    if stats_after_align["match_ratio"] < args.min_match_ratio:
        return {
            **base_row,
            "status": "rejected",
            "reason": "match_ratio_below_threshold",
        }

    if stats_after_align["median_match_cer"] > args.max_median_cer:
        return {
            **base_row,
            "status": "rejected",
            "reason": "median_cer_above_threshold",
        }

    xml_path = pagexml_path_for(page, args.output_dir)
    width = page.width or image_size[0]
    height = page.height or image_size[1]
    write_pagexml(
        output_path=xml_path,
        image_path=image_path,
        image_width=width,
        image_height=height,
        classified_lines=classified,
        pagexml_root=args.output_dir,
    )
    return {
        **base_row,
        "pagexml_path": str(xml_path).replace("\\", "/"),
        "status": "accepted",
    }


def main() -> int:
    args = parse_args()
    client = OmekaClient(cache_dir=args.cache_dir, delay_seconds=args.delay_seconds)

    print(f"Discovering transcribed pages (limit={args.limit})...")
    processed_for_discovery = load_checkpoint(args.checkpoint) if args.resume else set()
    if args.unprocessed_only:
        pages = collect_unprocessed_transcribed_pages(
            client,
            processed_for_discovery,
            limit=args.limit,
            seed=args.shuffle_seed,
        )
    else:
        pages = collect_transcribed_pages(client, limit=args.limit, seed=args.shuffle_seed)
    print(f"Selected {len(pages)} pages for processing.")

    if args.discover_only:
        discovery_path = args.manifest.with_name("kraken_gt_discovery.jsonl")
        discovery_path.parent.mkdir(parents=True, exist_ok=True)
        with discovery_path.open("w", encoding="utf-8") as handle:
            for page in pages:
                handle.write(json.dumps(asdict(page), ensure_ascii=False, sort_keys=True) + "\n")
        print(f"Wrote discovery manifest to {discovery_path}")
        return 0

    processed = load_checkpoint(args.checkpoint) if args.resume else set()
    runtime = KrakenRuntime(
        device=args.device,
        batch_size=args.batch_size,
        precision=args.precision,
        recognition_model=args.kraken_model,
    )

    accepted = 0
    rejected = 0
    skipped = 0
    for index, page in enumerate(pages, start=1):
        if page.media_id in processed:
            skipped += 1
            continue
        print(f"[{index}/{len(pages)}] {page_id(page)}")
        parsed_preview = training_lines(parse_scripto_transcription(page.transcription))
        if len(parsed_preview) < args.min_training_lines:
            rejected += 1
            append_jsonl(
                args.review_manifest,
                {
                    "id": page_id(page),
                    "document_id": page.document_id,
                    "media_id": page.media_id,
                    "status": "rejected",
                    "reason": "too_few_training_lines",
                    "training_lines": len(parsed_preview),
                },
            )
            processed.add(page.media_id)
            save_checkpoint(args.checkpoint, processed)
            print(f"  rejected (too_few_training_lines={len(parsed_preview)})")
            continue
        try:
            result = process_page(page, client, runtime, args)
        except Exception as error:
            result = {
                "id": page_id(page),
                "document_id": page.document_id,
                "media_id": page.media_id,
                "status": "rejected",
                "reason": f"error:{error}",
            }
            rejected += 1
            append_jsonl(args.review_manifest, result)
            processed.add(page.media_id)
            save_checkpoint(args.checkpoint, processed)
            print(f"  rejected ({error})")
            continue

        if result.get("status") == "accepted":
            accepted += 1
            append_jsonl(args.manifest, result)
            print(f"  accepted ({result.get('validated_lines')} lines)")
        else:
            rejected += 1
            append_jsonl(args.review_manifest, result)
            print(f"  rejected ({result.get('reason')})")

        processed.add(page.media_id)
        save_checkpoint(args.checkpoint, processed)

    print(
        f"Done. accepted={accepted} rejected={rejected} skipped={skipped} "
        f"manifest={args.manifest} review={args.review_manifest}"
    )
    return 0 if accepted > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
