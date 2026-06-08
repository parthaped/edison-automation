#!/usr/bin/env python3
"""Rebuild PAGE XML with only high-confidence aligned lines for cleaner Kraken training."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from build_hybrid_ground_truth import process_hybrid_page  # noqa: E402
from build_kraken_ground_truth import image_path_for, pagexml_path_for  # noqa: E402
from kraken_gt.confidence_filter import (  # noqa: E402
    filter_trainable_lines,
    page_manifest_is_high_quality,
)
from kraken_gt.hybrid_fusion import write_classified_pagexml  # noqa: E402
from kraken_gt.kraken_align import KrakenRuntime  # noqa: E402
from kraken_gt.regions import ClassifiedLine  # noqa: E402
from label_provider import resolve_label_provider, transcribe_page_cached  # noqa: E402
from kraken_gt.hybrid_fusion import (  # noqa: E402
    align_scripto_to_segments,
    align_vision_lines_to_segments,
    fuse_scripto_and_vision,
)
from kraken_gt.transcript_validate import classify_transcript  # noqa: E402
from rutgers_omeka import OmekaClient, TranscribedPage  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument("--output-dir", type=Path, default=Path("ml/data/pagexml_confidence"))
    parser.add_argument("--page-list", type=Path, default=Path("ml/data/manifests/confidence_train_pagexml.txt"))
    parser.add_argument("--report", type=Path, default=Path("ml/reports/confidence_pagexml_report.jsonl"))
    parser.add_argument("--images-dir", type=Path, default=Path("ml/data/raw"))
    parser.add_argument("--scripto-dir", type=Path, default=Path("ml/data/transcripts/scripto"))
    parser.add_argument("--vision-cache-dir", type=Path, default=Path("ml/data/cache/vision_labels"))
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--label-provider", default="auto", dest="label_provider")
    parser.add_argument("--max-line-cer", type=float, default=0.28)
    parser.add_argument("--min-lines", type=int, default=3)
    parser.add_argument("--tier-a-only", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    return parser.parse_args()


def load_manifest(path: Path) -> list[dict[str, object]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def fetch_page(client: OmekaClient, media_id: int) -> TranscribedPage | None:
    record = client.fetch_json(f"https://edisondigital.rutgers.edu/api/media/{media_id}")
    return client.parse_media_record(record)


def collect_classified_lines(
    page: TranscribedPage,
    *,
    images_dir: Path,
    segment_runtime: KrakenRuntime,
    vision_provider: object,
    vision_cache_dir: Path,
    label_source: str,
) -> tuple[list[ClassifiedLine], tuple[int, int]]:
    image_path = image_path_for(page, images_dir)
    segmented, image_size = segment_runtime.segmented_lines_with_ocr(image_path)
    scripto_classified, scripto_stats = align_scripto_to_segments(
        page.transcription,
        segmented,
        image_path,
        image_size,
        segment_runtime,
        skip_forced_align=False,
    )
    validation = classify_transcript(
        page.transcription,
        segmented_lines=len(segmented),
        match_ratio=float(scripto_stats.get("match_ratio") or 0.0),
    )

    if label_source.startswith("vision") or validation.transcript_type == "summary":
        vision_lines, _ = transcribe_page_cached(vision_provider, image_path, page_id(page), vision_cache_dir)
        return align_vision_lines_to_segments(vision_lines, segmented, image_size)[0], image_size

    vision_lines, _ = transcribe_page_cached(vision_provider, image_path, page_id(page), vision_cache_dir)
    vision_classified, _ = align_vision_lines_to_segments(vision_lines, segmented, image_size)
    if label_source == "scripto_vision_agreed" and vision_classified:
        classified, _, _ = fuse_scripto_and_vision(
            scripto_classified,
            vision_classified,
            transcript_type=validation.transcript_type,
        )
        return classified, image_size
    return scripto_classified, image_size


def page_id(page: TranscribedPage) -> str:
    return f"{page.document_id}_{page.page_stem}"


def main() -> int:
    args = parse_args()
    rows = load_manifest(args.manifest)
    if args.limit > 0:
        rows = rows[: args.limit]

    client = OmekaClient(cache_dir=Path("ml/data/cache/omeka"))
    segment_runtime = KrakenRuntime(device=args.device, recognition_model=args.kraken_model)
    vision_provider = resolve_label_provider(args.label_provider, device=args.device)
    hybrid_args = argparse.Namespace(
        images_dir=args.images_dir,
        scripto_dir=args.scripto_dir,
        output_dir=args.output_dir,
        vision_cache_dir=args.vision_cache_dir,
        skip_forced_align=False,
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.report.parent.mkdir(parents=True, exist_ok=True)

    train_paths: list[str] = []
    report_rows: list[dict[str, object]] = []

    for row in rows:
        pid = str(row.get("id", ""))
        if args.tier_a_only:
            ok, reason = page_manifest_is_high_quality(row)
            if not ok:
                report_rows.append({"id": pid, "status": "skipped", "reason": reason})
                continue

        media_id = int(row.get("media_id") or 0)
        if not media_id:
            report_rows.append({"id": pid, "status": "skipped", "reason": "no_media_id"})
            continue

        page = fetch_page(client, media_id)
        if page is None:
            report_rows.append({"id": pid, "status": "skipped", "reason": "fetch_failed"})
            continue

        hybrid_result = process_hybrid_page(page, client, segment_runtime, vision_provider, hybrid_args)
        if hybrid_result.get("status") != "accepted":
            report_rows.append(
                {"id": pid, "status": "skipped", "reason": hybrid_result.get("reason", "hybrid_rejected")}
            )
            continue

        classified, image_size = collect_classified_lines(
            page,
            images_dir=args.images_dir,
            segment_runtime=segment_runtime,
            vision_provider=vision_provider,
            vision_cache_dir=args.vision_cache_dir,
            label_source=str(hybrid_result.get("label_source", "scripto")),
        )
        filtered, confidence = filter_trainable_lines(
            classified,
            max_line_cer=args.max_line_cer,
            min_lines=args.min_lines,
        )
        if not confidence.accepted:
            report_rows.append(
                {
                    "id": pid,
                    "status": "skipped",
                    "reason": confidence.reason,
                    "kept_lines": confidence.kept_lines,
                    "dropped_lines": confidence.dropped_lines,
                }
            )
            continue

        image_path = image_path_for(page, args.images_dir)
        out_path = pagexml_path_for(page, args.output_dir)
        write_classified_pagexml(
            output_path=out_path,
            image_path=image_path,
            image_width=page.width or image_size[0],
            image_height=page.height or image_size[1],
            classified=filtered,
            pagexml_root=args.output_dir,
        )
        rel = str(out_path).replace("\\", "/")
        train_paths.append(rel)
        report_rows.append(
            {
                "id": pid,
                "status": "accepted",
                "pagexml_path": rel,
                "kept_lines": confidence.kept_lines,
                "dropped_lines": confidence.dropped_lines,
                "mean_kept_cer": confidence.mean_kept_cer,
                "label_source": hybrid_result.get("label_source"),
            }
        )
        print(f"  {pid}: {confidence.kept_lines} confident lines")

    args.page_list.parent.mkdir(parents=True, exist_ok=True)
    args.page_list.write_text("\n".join(sorted(set(train_paths))) + ("\n" if train_paths else ""), encoding="utf-8")
    with args.report.open("w", encoding="utf-8") as handle:
        for report in report_rows:
            handle.write(json.dumps(report, ensure_ascii=False, sort_keys=True) + "\n")

    print(f"Confidence PAGE XML: {len(train_paths)} pages -> {args.page_list}")
    return 0 if train_paths else 1


if __name__ == "__main__":
    raise SystemExit(main())
