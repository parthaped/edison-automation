#!/usr/bin/env python3
"""Re-audit accepted GT pages for summary Scripto vs diplomatic transcripts."""

from __future__ import annotations

import argparse
import csv
import json
import sys
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
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument("--review-manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_review.jsonl"))
    parser.add_argument("--output-report", type=Path, default=Path("ml/reports/gt_audit_report.csv"))
    parser.add_argument("--reclassify", action="store_true")
    parser.add_argument("--vision-relabel", action="store_true")
    parser.add_argument("--label-provider", default="auto", dest="label_provider")
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--limit", type=int, default=0, help="Max pages to audit (0 = all).")
    return parser.parse_args()


def load_manifest(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def fetch_transcription(client: OmekaClient, media_id: int) -> str:
    record = client.fetch_json(f"https://edisondigital.rutgers.edu/api/media/{media_id}")
    page = client.parse_media_record(record)
    if page is None:
        return ""
    return page.transcription


def main() -> int:
    args = parse_args()
    rows = load_manifest(args.manifest)
    if args.limit > 0:
        rows = rows[: args.limit]

    client = OmekaClient(cache_dir=Path("ml/data/cache/omeka"))
    report_rows: list[dict[str, object]] = []
    demote_ids: list[str] = []

    for row in rows:
        page_id = str(row.get("id", ""))
        media_id = int(row.get("media_id") or 0)
        training_lines = int(row.get("training_lines") or 0)
        segmented_lines = int(row.get("segmented_lines") or 0)

        transcription = ""
        if media_id:
            try:
                transcription = fetch_transcription(client, media_id)
            except Exception:
                transcription = ""

        validation = classify_transcript(
            transcription,
            segmented_lines=segmented_lines,
            match_ratio=float(row.get("match_ratio") or 0.0) if row.get("match_ratio") is not None else None,
        )
        match_ratio = float(row.get("match_ratio") or 0.0)
        mean_cer = float(row.get("mean_match_cer") or 0.0)
        seg_ratio = segmented_lines / max(training_lines, 1)
        demote = (
            validation.transcript_type == "summary"
            or (training_lines <= 3 and segmented_lines >= 12)
            or match_ratio < 0.72
            or mean_cer > 0.35
            or seg_ratio > 2.5
        )
        action = "keep"
        if demote:
            demote_ids.append(page_id)
            action = "demote_summary" if validation.transcript_type == "summary" else "demote_low_lines"

        report_rows.append(
            {
                "id": page_id,
                "media_id": media_id,
                "transcript_type": validation.transcript_type,
                "reasons": ";".join(validation.reasons),
                "training_lines": training_lines,
                "segmented_lines": segmented_lines,
                "label_source": row.get("label_source", "scripto"),
                "action": action,
            }
        )

    args.output_report.parent.mkdir(parents=True, exist_ok=True)
    with args.output_report.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(report_rows[0].keys()) if report_rows else [])
        if report_rows:
            writer.writeheader()
            writer.writerows(report_rows)

    counts: dict[str, int] = {}
    for report in report_rows:
        key = str(report.get("action", "keep"))
        counts[key] = counts.get(key, 0) + 1

    print(f"Audited {len(report_rows)} accepted pages -> {args.output_report}")
    for key, count in sorted(counts.items()):
        print(f"  {key}: {count}")

    if not args.reclassify or not demote_ids:
        return 0

    kept_rows = [row for row in rows if str(row.get("id")) not in demote_ids]
    args.manifest.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in kept_rows) + "\n",
        encoding="utf-8",
    )
    print(f"Removed {len(demote_ids)} pages from manifest.")

    if args.vision_relabel:
        import argparse as ap

        vision_provider = resolve_label_provider(args.label_provider, device=args.device)
        segment_runtime = KrakenRuntime(device=args.device, recognition_model=args.kraken_model)
        hybrid_args = ap.Namespace(
            images_dir=Path("ml/data/raw"),
            scripto_dir=Path("ml/data/transcripts/scripto"),
            output_dir=Path("ml/data/pagexml"),
            vision_cache_dir=Path("ml/data/cache/vision_labels"),
            skip_forced_align=False,
        )

        relabeled = 0
        for row in rows:
            if str(row.get("id")) not in demote_ids:
                continue
            media_id = int(row.get("media_id") or 0)
            if not media_id:
                continue
            record = client.fetch_json(f"https://edisondigital.rutgers.edu/api/media/{media_id}")
            page = client.parse_media_record(record)
            if page is None:
                continue
            print(f"Vision relabel {row.get('id')}")
            try:
                result = process_hybrid_page(page, client, segment_runtime, vision_provider, hybrid_args)
            except Exception as error:
                append_jsonl(
                    args.review_manifest,
                    {**row, "status": "rejected", "reason": f"audit_relabel_error:{error}"},
                )
                continue
            if result.get("status") == "accepted":
                relabeled += 1
                append_jsonl(args.manifest, result)
            else:
                append_jsonl(args.review_manifest, {**row, **result})

        print(f"Vision relabeled {relabeled} demoted pages.")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
