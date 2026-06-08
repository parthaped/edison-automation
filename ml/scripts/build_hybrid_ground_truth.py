#!/usr/bin/env python3
"""Build hybrid Scripto + vision-OCR PAGE XML ground truth for Edison Digital."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_kraken_ground_truth import (  # noqa: E402
    append_jsonl,
    image_path_for,
    load_checkpoint,
    page_id,
    pagexml_path_for,
    save_checkpoint,
    scripto_path_for,
)
from kraken_gt.hybrid_fusion import (  # noqa: E402
    acceptance_result,
    align_scripto_to_segments,
    align_vision_lines_to_segments,
    fuse_scripto_and_vision,
    write_classified_pagexml,
)
from kraken_gt.kraken_align import KrakenRuntime  # noqa: E402
from kraken_gt.scripto import parse_scripto_transcription, training_lines  # noqa: E402
from kraken_gt.transcript_validate import classify_transcript  # noqa: E402
from label_provider import resolve_label_provider, transcribe_page_cached  # noqa: E402
from rutgers_omeka import (  # noqa: E402
    OmekaClient,
    TranscribedPage,
    classify_split,
    collect_transcribed_pages,
    collect_unprocessed_transcribed_pages,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=500)
    parser.add_argument("--output-dir", type=Path, default=Path("ml/data/pagexml"))
    parser.add_argument("--images-dir", type=Path, default=Path("ml/data/raw"))
    parser.add_argument("--scripto-dir", type=Path, default=Path("ml/data/transcripts/scripto"))
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument("--review-manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_review.jsonl"))
    parser.add_argument("--checkpoint", type=Path, default=Path("ml/data/manifests/kraken_gt_checkpoint.json"))
    parser.add_argument("--cache-dir", type=Path, default=Path("ml/data/cache/omeka"))
    parser.add_argument("--vision-cache-dir", type=Path, default=Path("ml/data/cache/vision_labels"))
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--precision", default="bf16-mixed")
    parser.add_argument("--delay-seconds", type=float, default=0.5)
    parser.add_argument("--shuffle-seed", type=int, default=42)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--discover-only", action="store_true")
    parser.add_argument("--unprocessed-only", action="store_true")
    parser.add_argument("--skip-forced-align", action="store_true")
    parser.add_argument("--label-provider", default="auto", dest="label_provider")
    return parser.parse_args()


def process_hybrid_page(
    page: TranscribedPage,
    client: OmekaClient,
    segment_runtime: KrakenRuntime,
    vision_provider: object,
    args: argparse.Namespace,
) -> dict[str, object]:
    image_path = image_path_for(page, args.images_dir)
    client.download_binary(page.image_url, image_path)

    scripto_copy = scripto_path_for(page, args.scripto_dir)
    if not scripto_copy.exists():
        scripto_copy.parent.mkdir(parents=True, exist_ok=True)
        scripto_copy.write_text(page.transcription.rstrip() + "\n", encoding="utf-8")

    segmented, image_size = segment_runtime.segmented_lines_with_ocr(image_path)
    validation = classify_transcript(page.transcription, segmented_lines=len(segmented))

    scripto_classified, scripto_stats = align_scripto_to_segments(
        page.transcription,
        segmented,
        image_path,
        image_size,
        segment_runtime,
        skip_forced_align=args.skip_forced_align,
    )
    scripto_match_ratio = float(scripto_stats.get("match_ratio") or 0.0)
    validation = classify_transcript(
        page.transcription,
        segmented_lines=len(segmented),
        match_ratio=scripto_match_ratio,
    )

    base_row: dict[str, object] = {
        "id": page_id(page),
        "document_id": page.document_id,
        "media_id": page.media_id,
        "document_type": page.document_type,
        "image_path": str(image_path).replace("\\", "/"),
        "scripto_lines": len(parse_scripto_transcription(page.transcription)),
        "training_lines": scripto_stats.get("training_lines", 0),
        "segmented_lines": len(segmented),
        "split": classify_split(page.document_id),
        "transcript_type": validation.transcript_type,
        "transcript_reasons": validation.reasons,
    }

    mean_scripto_cer = float(scripto_stats.get("mean_match_cer") or 0.0)
    seg_ratio = len(segmented) / max(int(scripto_stats.get("training_lines") or 1), 1)
    force_vision = bool(getattr(args, "force_vision", False))
    scripto_only = bool(getattr(args, "scripto_only", False))
    need_vision = (not scripto_only) and (
        force_vision
        or (
        validation.transcript_type in {"summary", "ambiguous"}
        or scripto_match_ratio < 0.75
        or mean_scripto_cer > 0.25
        or seg_ratio > 2.0
        or len(scripto_classified) < 4
        )
    )

    vision_classified: list = []
    vision_stats: dict[str, object] = {}
    vision_provider_name = ""
    if need_vision:
        try:
            vision_lines, _ = transcribe_page_cached(
                vision_provider,
                image_path,
                page_id(page),
                args.vision_cache_dir,
            )
            vision_classified, vision_stats = align_vision_lines_to_segments(
                vision_lines, segmented, image_size
            )
            vision_provider_name = vision_provider.name  # type: ignore[attr-defined]
        except Exception as error:
            if force_vision or validation.transcript_type == "summary":
                return {
                    **base_row,
                    "status": "rejected",
                    "reason": f"vision_ocr_failed:{error}",
                    "label_source": "none",
                }

    if force_vision and vision_classified:
        fused = vision_classified
        label_source = "vision_primary"
        quality_flags = []
        stats = vision_stats
    elif (
        validation.transcript_type == "diplomatic"
        and scripto_match_ratio >= 0.75
        and mean_scripto_cer <= 0.25
        and seg_ratio <= 2.0
        and len(scripto_classified) >= 4
    ):
        fused = scripto_classified
        label_source = "scripto"
        quality_flags: list[str] = []
        stats = scripto_stats
        if vision_classified:
            fused, label_source, quality_flags = fuse_scripto_and_vision(
                scripto_classified,
                vision_classified,
                transcript_type=validation.transcript_type,
            )
            stats = scripto_stats if label_source.startswith("scripto") else vision_stats
    elif vision_classified:
        fused = vision_classified
        label_source = "vision_primary"
        quality_flags = []
        stats = vision_stats
    else:
        fused = scripto_classified
        label_source = "scripto"
        quality_flags = []
        stats = scripto_stats

    result = acceptance_result(
        fused,
        stats,
        label_source=label_source,
        transcript_validation=validation,
        vision_provider=vision_provider_name,
    )
    row = {**base_row, **result, "quality_flags": quality_flags}

    if result.get("status") != "accepted":
        return {**row, "reason": result.get("reason", "rejected")}

    xml_path = pagexml_path_for(page, args.output_dir)
    width = page.width or image_size[0]
    height = page.height or image_size[1]
    pagexml_rel = write_classified_pagexml(
        output_path=xml_path,
        image_path=image_path,
        image_width=width,
        image_height=height,
        classified=fused,
        pagexml_root=args.output_dir,
    )
    return {**row, "pagexml_path": pagexml_rel, "status": "accepted"}


def main() -> int:
    args = parse_args()
    client = OmekaClient(cache_dir=args.cache_dir, delay_seconds=args.delay_seconds)

    processed_for_discovery = load_checkpoint(args.checkpoint) if args.resume else set()
    if args.unprocessed_only:
        pages = collect_unprocessed_transcribed_pages(
            client, processed_for_discovery, limit=args.limit, seed=args.shuffle_seed
        )
    else:
        pages = collect_transcribed_pages(client, limit=args.limit, seed=args.shuffle_seed)
    print(f"Selected {len(pages)} pages for hybrid GT build.")

    if args.discover_only:
        discovery_path = args.manifest.with_name("kraken_gt_discovery.jsonl")
        with discovery_path.open("w", encoding="utf-8") as handle:
            for page in pages:
                handle.write(json.dumps(asdict(page), ensure_ascii=False, sort_keys=True) + "\n")
        print(f"Wrote {discovery_path}")
        return 0

    vision_provider = resolve_label_provider(args.label_provider, device=args.device)
    print(f"Vision-OCR provider: {vision_provider.name}")

    segment_runtime = KrakenRuntime(
        device=args.device,
        batch_size=args.batch_size,
        precision=args.precision,
        recognition_model=args.kraken_model,
    )

    processed = load_checkpoint(args.checkpoint) if args.resume else set()
    accepted = rejected = skipped = 0

    for index, page in enumerate(pages, start=1):
        if page.media_id in processed:
            skipped += 1
            continue
        print(f"[{index}/{len(pages)}] {page_id(page)}")
        try:
            result = process_hybrid_page(page, client, segment_runtime, vision_provider, args)
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
            print(
                f"  accepted ({result.get('validated_lines')} lines, "
                f"source={result.get('label_source')}, type={result.get('transcript_type')})"
            )
        else:
            rejected += 1
            append_jsonl(args.review_manifest, result)
            print(f"  rejected ({result.get('reason')})")

        processed.add(page.media_id)
        save_checkpoint(args.checkpoint, processed)

    print(f"Done. accepted={accepted} rejected={rejected} skipped={skipped}")
    return 0 if accepted > 0 or skipped > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
