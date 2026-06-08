#!/usr/bin/env python3
"""Upgrade legacy Scripto-only manifest rows with hybrid vision verification.

The original 345-page corpus lacks label_source / transcript_type metadata and was
never vision-checked. This re-runs hybrid alignment in-place so curation tiers and
confidence filtering can use accurate label provenance.
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
from kraken_gt.confidence_filter import page_manifest_is_high_quality  # noqa: E402
from kraken_gt.kraken_align import KrakenRuntime  # noqa: E402
from label_provider import resolve_label_provider  # noqa: E402
from rutgers_omeka import OmekaClient, TranscribedPage  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument("--review-manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_review.jsonl"))
    parser.add_argument("--backup", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.pre_upgrade.jsonl"))
    parser.add_argument("--pagexml-dir", type=Path, default=Path("ml/data/pagexml"))
    parser.add_argument("--images-dir", type=Path, default=Path("ml/data/raw"))
    parser.add_argument("--scripto-dir", type=Path, default=Path("ml/data/transcripts/scripto"))
    parser.add_argument("--vision-cache-dir", type=Path, default=Path("ml/data/cache/vision_labels"))
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--label-provider", default="auto", dest="label_provider")
    parser.add_argument("--limit", type=int, default=0, help="Max pages to upgrade (0 = all).")
    parser.add_argument(
        "--only-legacy",
        action="store_true",
        help="Only upgrade rows missing label_source (default behaviour).",
    )
    parser.add_argument("--demote-low-quality", action="store_true", help="Move upgraded pages that fail strict QC to review.")
    parser.add_argument("--delay-seconds", type=float, default=0.5)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path("ml/data/manifests/upgrade_gt_checkpoint.json"),
    )
    parser.add_argument("--resume", action="store_true", help="Skip pages already recorded in --checkpoint.")
    parser.add_argument(
        "--skip-forced-align",
        action="store_true",
        help="Skip Kraken forced alignment (faster; recommended for overnight vision-primary runs).",
    )
    return parser.parse_args()


def load_manifest(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def load_checkpoint(path: Path) -> set[str]:
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    done = data.get("completed_ids") or []
    return {str(page_id) for page_id in done}


def save_checkpoint(path: Path, completed_ids: set[str], upgraded: int, demoted: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "completed_ids": sorted(completed_ids),
                "upgraded": upgraded,
                "demoted": demoted,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def write_manifest(path: Path, rows: list[dict[str, object]]) -> None:
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows) + "\n",
        encoding="utf-8",
    )


def fetch_page(client: OmekaClient, media_id: int) -> TranscribedPage | None:
    for attempt in range(5):
        try:
            record = client.fetch_json(f"https://edisondigital.rutgers.edu/api/media/{media_id}")
            return client.parse_media_record(record)
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None


def main() -> int:
    args = parse_args()
    rows = load_manifest(args.manifest)
    if args.limit > 0:
        rows = rows[: args.limit]

    completed = load_checkpoint(args.checkpoint) if args.resume else set()
    to_upgrade = [
        row
        for row in rows
        if (not args.only_legacy or not row.get("label_source"))
        and str(row.get("id", "")) not in completed
    ]
    if not to_upgrade:
        print("No legacy rows need upgrade.")
        return 0

    if not args.backup.exists():
        args.backup.write_text(
            "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in load_manifest(args.manifest))
            + "\n",
            encoding="utf-8",
        )
        print(f"Backup: {args.backup}")

    client = OmekaClient(cache_dir=Path("ml/data/cache/omeka"), delay_seconds=args.delay_seconds)
    vision_provider = resolve_label_provider(args.label_provider, device=args.device)
    segment_runtime = KrakenRuntime(device=args.device, recognition_model=args.kraken_model)
    hybrid_args = argparse.Namespace(
        images_dir=args.images_dir,
        scripto_dir=args.scripto_dir,
        output_dir=args.pagexml_dir,
        vision_cache_dir=args.vision_cache_dir,
        skip_forced_align=args.skip_forced_align,
    )

    upgraded_count = 0
    demoted_count = 0
    manifest_rows = load_manifest(args.manifest)
    row_by_id = {str(row.get("id", "")): row for row in manifest_rows}

    def flush_manifest() -> None:
        ordered = [row_by_id[str(row.get("id", ""))] for row in manifest_rows if str(row.get("id", "")) in row_by_id]
        write_manifest(args.manifest, ordered)

    print(
        f"Upgrading {len(to_upgrade)} pages with {vision_provider.name} "
        f"(resume={args.resume}, skip_forced_align={args.skip_forced_align})",
        flush=True,
    )
    for index, row in enumerate(to_upgrade, start=1):
        page_id = str(row.get("id", ""))
        media_id = int(row.get("media_id") or 0)
        if not media_id:
            completed.add(page_id)
            save_checkpoint(args.checkpoint, completed, upgraded_count, demoted_count)
            continue
        page = fetch_page(client, media_id)
        if page is None:
            print(f"[{index}/{len(to_upgrade)}] {page_id} fetch failed", flush=True)
            continue

        print(f"[{index}/{len(to_upgrade)}] {page_id}", flush=True)
        try:
            result = process_hybrid_page(page, client, segment_runtime, vision_provider, hybrid_args)
        except Exception as error:
            print(f"  error ({error})", flush=True)
            completed.add(page_id)
            save_checkpoint(args.checkpoint, completed, upgraded_count, demoted_count)
            continue

        if result.get("status") != "accepted":
            if args.demote_low_quality:
                demoted_count += 1
                row_by_id.pop(page_id, None)
                append_jsonl(args.review_manifest, {**row, **result})
            print(f"  demoted ({result.get('reason')})", flush=True)
            completed.add(page_id)
            flush_manifest()
            save_checkpoint(args.checkpoint, completed, upgraded_count, demoted_count)
            continue

        if args.demote_low_quality:
            ok, reason = page_manifest_is_high_quality(result)
            if not ok:
                demoted_count += 1
                row_by_id.pop(page_id, None)
                append_jsonl(args.review_manifest, {**row, **result, "reason": f"upgrade_qc:{reason}"})
                print(f"  demoted (qc:{reason})", flush=True)
                completed.add(page_id)
                flush_manifest()
                save_checkpoint(args.checkpoint, completed, upgraded_count, demoted_count)
                continue

        row_by_id[page_id] = result
        upgraded_count += 1
        completed.add(page_id)
        flush_manifest()
        save_checkpoint(args.checkpoint, completed, upgraded_count, demoted_count)
        print(
            f"  upgraded ({result.get('validated_lines')} lines, "
            f"source={result.get('label_source')}, type={result.get('transcript_type')})",
            flush=True,
        )

    print(f"Upgraded {upgraded_count} pages, demoted {demoted_count}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
