#!/usr/bin/env python3
"""Rebuild training PAGE XML using Scripto-only alignment (no circular vision labels)."""

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
from rutgers_omeka import OmekaClient, TranscribedPage  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_manifest.jsonl"))
    parser.add_argument("--review-manifest", type=Path, default=Path("ml/data/manifests/kraken_gt_review.jsonl"))
    parser.add_argument(
        "--frozen-test-manifest",
        type=Path,
        default=Path("ml/data/manifests/kraken_gt_manifest.pre_upgrade.jsonl"),
    )
    parser.add_argument("--pagexml-dir", type=Path, default=Path("ml/data/pagexml"))
    parser.add_argument("--images-dir", type=Path, default=Path("ml/data/raw"))
    parser.add_argument("--scripto-dir", type=Path, default=Path("ml/data/transcripts/scripto"))
    parser.add_argument("--kraken-model", type=Path, default=Path("ml/models/en_best.mlmodel"))
    parser.add_argument("--device", default="cuda:0")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--delay-seconds", type=float, default=0.3)
    parser.add_argument(
        "--checkpoint",
        type=Path,
        default=Path("ml/data/manifests/relabel_scripto_checkpoint.json"),
    )
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--skip-forced-align", action="store_true", default=True)
    parser.add_argument("--page-list", type=Path, default=None)
    parser.add_argument("--demote-low-quality", action="store_true")
    return parser.parse_args()


def load_rows(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                rows.append(json.loads(line))
    return rows


def frozen_test_ids(path: Path) -> set[str]:
    if not path.exists():
        return set()
    return {str(row["id"]) for row in load_rows(path) if row.get("split") == "test"}


def load_checkpoint(path: Path) -> set[str]:
    if not path.exists():
        return set()
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(page_id) for page_id in (data.get("completed_ids") or [])}


def save_checkpoint(path: Path, completed_ids: set[str], relabeled: int, skipped: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"completed_ids": sorted(completed_ids), "relabeled": relabeled, "skipped": skipped},
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


def pagexml_allowlist(path: Path | None) -> set[str] | None:
    if path is None or not path.exists():
        return None
    return {str(Path(line.strip()).as_posix()) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()}


def needs_scripto_relabel(row: dict[str, object], frozen: set[str], allowlist: set[str] | None) -> bool:
    page_id = str(row.get("id", ""))
    if not page_id or page_id in frozen:
        return False
    if row.get("status") != "accepted":
        return False
    if row.get("split") not in {"train", "validation"}:
        return False
    pagexml = row.get("pagexml_path")
    if not pagexml:
        return False
    if allowlist is not None and str(Path(str(pagexml)).as_posix()) not in allowlist:
        return False
    if row.get("label_source") == "scripto" and row.get("vision_provider") != "kraken_phase2":
        return False
    return True


def main() -> int:
    args = parse_args()
    frozen = frozen_test_ids(args.frozen_test_manifest)
    allowlist = pagexml_allowlist(args.page_list)
    completed = load_checkpoint(args.checkpoint) if args.resume else set()

    manifest_rows = load_rows(args.manifest)
    row_by_id = {str(row.get("id", "")): row for row in manifest_rows}

    candidates = [
        row
        for row in manifest_rows
        if needs_scripto_relabel(row, frozen, allowlist) and str(row.get("id", "")) not in completed
    ]
    if args.limit > 0:
        candidates = candidates[: args.limit]

    if not candidates:
        print("No training pages need Scripto-only relabel.")
        return 0

    print(f"Scripto-only relabel: {len(candidates)} pages", flush=True)

    client = OmekaClient(cache_dir=Path("ml/data/cache/omeka"), delay_seconds=args.delay_seconds)
    segment_runtime = KrakenRuntime(device=args.device, recognition_model=args.kraken_model)
    hybrid_args = argparse.Namespace(
        images_dir=args.images_dir,
        scripto_dir=args.scripto_dir,
        output_dir=args.pagexml_dir,
        vision_cache_dir=Path("ml/data/cache/vision_labels"),
        skip_forced_align=args.skip_forced_align,
        force_vision=False,
        scripto_only=True,
    )

    relabeled = 0
    skipped = 0

    def flush_manifest() -> None:
        ordered = [row_by_id[str(row.get("id", ""))] for row in manifest_rows if str(row.get("id", "")) in row_by_id]
        write_manifest(args.manifest, ordered)

    for index, row in enumerate(candidates, start=1):
        page_id = str(row.get("id", ""))
        media_id = int(row.get("media_id") or 0)
        if not media_id:
            completed.add(page_id)
            save_checkpoint(args.checkpoint, completed, relabeled, skipped)
            continue

        page = fetch_page(client, media_id)
        if page is None:
            print(f"[{index}/{len(candidates)}] {page_id} fetch failed", flush=True)
            continue

        print(f"[{index}/{len(candidates)}] {page_id}", flush=True)
        try:
            result = process_hybrid_page(page, client, segment_runtime, None, hybrid_args)
        except Exception as error:
            print(f"  error ({error})", flush=True)
            completed.add(page_id)
            save_checkpoint(args.checkpoint, completed, relabeled, skipped)
            continue

        if result.get("status") != "accepted" or result.get("label_source") != "scripto":
            skipped += 1
            if args.demote_low_quality and result.get("status") != "accepted":
                row_by_id.pop(page_id, None)
                append_jsonl(args.review_manifest, {**row, **result})
            print(f"  skipped ({result.get('reason', result.get('label_source'))})", flush=True)
            completed.add(page_id)
            save_checkpoint(args.checkpoint, completed, relabeled, skipped)
            continue

        if args.demote_low_quality:
            ok, reason = page_manifest_is_high_quality(result)
            if not ok:
                skipped += 1
                row_by_id.pop(page_id, None)
                append_jsonl(args.review_manifest, {**row, **result, "reason": f"scripto_qc:{reason}"})
                print(f"  skipped (qc:{reason})", flush=True)
                completed.add(page_id)
                flush_manifest()
                save_checkpoint(args.checkpoint, completed, relabeled, skipped)
                continue

        row_by_id[page_id] = result
        relabeled += 1
        completed.add(page_id)
        flush_manifest()
        save_checkpoint(args.checkpoint, completed, relabeled, skipped)
        print(
            f"  scripto ({result.get('validated_lines')} lines, ratio={result.get('match_ratio')})",
            flush=True,
        )

    print(f"Scripto relabel complete: {relabeled} upgraded, {skipped} skipped", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
