#!/usr/bin/env python3
"""Harvest edisondigital.rutgers.edu Omeka S metadata into a search index."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.parse
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from rutgers_omeka import BASE_URL, OmekaClient  # noqa: E402

INDEX_VERSION = "v1"
DEFAULT_OUTPUT_DIR = SCRIPT_DIR.parent / "data" / "search"
PUBLIC_ITEM_URL = f"{BASE_URL}/s/omeka/page/taep-item"


def get_value_strings(values: list[dict[str, Any]] | None) -> list[str]:
    if not values:
        return []
    out: list[str] = []
    for entry in values:
        text = str(entry.get("@value", "")).strip()
        if text:
            out.append(text)
    return out


def get_first_value(values: list[dict[str, Any]] | None) -> str:
    strings = get_value_strings(values)
    return strings[0] if strings else ""


def parse_year(date: str) -> int | None:
    match = re.match(r"^(\d{4})", date.strip())
    if not match:
        return None
    year = int(match.group(1))
    if 1700 <= year <= 2100:
        return year
    return None


def parse_decade(year: int | None) -> int | None:
    if year is None:
        return None
    return (year // 10) * 10


def thumbnail_url(item: dict[str, Any]) -> str | None:
    urls = item.get("thumbnail_display_urls") or {}
    for key in ("large", "medium", "square"):
        value = urls.get(key)
        if value:
            return str(value)
    return None


def build_record(
    item: dict[str, Any],
    media_transcriptions: dict[int, list[str]],
) -> dict[str, Any]:
    item_id = int(item["o:id"])
    title = get_first_value(item.get("dcterms:title")) or str(item.get("o:title") or f"Item {item_id}")
    description = get_first_value(item.get("dcterms:description"))
    document_type = get_first_value(item.get("dcterms:type"))
    date = get_first_value(item.get("dcterms:date"))
    date_year = parse_year(date)
    date_decade = parse_decade(date_year)
    creators = get_value_strings(item.get("dcterms:creator"))
    recipients = get_value_strings(item.get("bibo:recipient"))
    names_mentioned = get_value_strings(item.get("dcterms:relation"))
    subjects = get_value_strings(item.get("dcterms:subject"))
    places = get_value_strings(item.get("dcterms:coverage"))
    is_part_of = get_first_value(item.get("dcterms:isPartOf"))
    identifier = get_first_value(item.get("dcterms:identifier"))

    item_transcription = get_first_value(item.get("scripto:transcription"))
    media_parts = media_transcriptions.get(item_id, [])
    transcription_parts = [item_transcription] if item_transcription else []
    transcription_parts.extend(media_parts)
    seen_text: set[str] = set()
    unique_parts: list[str] = []
    for part in transcription_parts:
        normalized = part.strip()
        if normalized and normalized not in seen_text:
            seen_text.add(normalized)
            unique_parts.append(normalized)
    transcription_text = "\n\n".join(unique_parts)
    transcription_preview = transcription_text[:500]

    searchable_parts = [
        title,
        description,
        document_type,
        date,
        identifier,
        is_part_of,
        transcription_text,
        *creators,
        *recipients,
        *names_mentioned,
        *subjects,
        *places,
    ]
    searchable_text = " ".join(part for part in searchable_parts if part).strip()

    return {
        "itemId": item_id,
        "identifier": identifier,
        "title": title,
        "description": description,
        "documentType": document_type,
        "date": date,
        "dateYear": date_year,
        "dateDecade": date_decade,
        "creators": creators,
        "recipients": recipients,
        "namesMentioned": names_mentioned,
        "subjects": subjects,
        "places": places,
        "isPartOf": is_part_of,
        "transcriptionText": transcription_text,
        "transcriptionPreview": transcription_preview,
        "searchableText": searchable_text,
        "thumbnailUrl": thumbnail_url(item),
        "edisonDigitalUrl": f"{PUBLIC_ITEM_URL}/{item_id}",
    }


def iter_public_items(client: OmekaClient, per_page: int = 100):
    page = 1
    while True:
        query = urllib.parse.urlencode({"page": str(page), "per_page": str(per_page)})
        url = f"{BASE_URL}/api/items?{query}"
        batch = client.fetch_json(url)
        if not batch:
            break
        for item in batch:
            if item.get("o:is_public", True):
                yield item
        if len(batch) < per_page:
            break
        page += 1


def collect_media_transcriptions(client: OmekaClient) -> dict[int, list[str]]:
    grouped: dict[int, list[str]] = {}
    for record in client.iter_transcribed_media():
        text = get_first_value(record.get("scripto:transcription"))
        if not text:
            continue
        item_ref = record.get("o:item") or {}
        item_id = item_ref.get("o:id")
        if item_id is None:
            continue
        grouped.setdefault(int(item_id), []).append(text)
    return grouped


def facet_entries(counter: Counter[str], limit: int | None = None) -> list[dict[str, Any]]:
    items = counter.most_common(limit)
    return [{"value": value, "count": count} for value, count in items if value]


def build_manifest(records: list[dict[str, Any]], jsonl_path: Path) -> dict[str, Any]:
    type_counts: Counter[str] = Counter()
    collection_counts: Counter[str] = Counter()
    decade_counts: Counter[str] = Counter()
    subject_counts: Counter[str] = Counter()
    place_counts: Counter[str] = Counter()
    creator_counts: Counter[str] = Counter()

    for record in records:
        if record["documentType"]:
            type_counts[record["documentType"]] += 1
        if record["isPartOf"]:
            collection_counts[record["isPartOf"]] += 1
        if record["dateDecade"] is not None:
            decade_counts[str(record["dateDecade"])] += 1
        for subject in record["subjects"]:
            subject_counts[subject] += 1
        for place in record["places"]:
            place_counts[place] += 1
        for creator in record["creators"]:
            creator_counts[creator] += 1

    payload = json.dumps(records, ensure_ascii=False, sort_keys=True)
    checksum = hashlib.sha256(payload.encode("utf-8")).hexdigest()

    return {
        "version": INDEX_VERSION,
        "builtAt": datetime.now(timezone.utc).isoformat(),
        "recordCount": len(records),
        "checksum": checksum,
        "jsonlPath": jsonl_path.name,
        "facets": {
            "documentTypes": facet_entries(type_counts),
            "collections": facet_entries(collection_counts),
            "decades": facet_entries(decade_counts),
            "subjects": facet_entries(subject_counts, 200),
            "places": facet_entries(place_counts, 100),
            "creators": facet_entries(creator_counts, 100),
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Build Edison Papers search index from Omeka S.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Directory for index artifacts (default: {DEFAULT_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=SCRIPT_DIR.parent / "data" / "omeka-cache",
        help="Omeka API response cache directory",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=0.5,
        help="Delay between uncached Omeka API requests (seconds)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Limit number of items (0 = no limit, for testing)",
    )
    args = parser.parse_args()

    output_dir: Path = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    client = OmekaClient(cache_dir=args.cache_dir, delay_seconds=args.delay)

    print("Collecting media transcriptions...", flush=True)
    media_transcriptions = collect_media_transcriptions(client)
    print(f"  Found transcriptions for {len(media_transcriptions)} items.", flush=True)

    records: list[dict[str, Any]] = []
    print("Harvesting public items...", flush=True)
    for index, item in enumerate(iter_public_items(client), start=1):
        records.append(build_record(item, media_transcriptions))
        if index % 100 == 0:
            print(f"  {index} items harvested...", flush=True)
        if args.limit and index >= args.limit:
            break

    records.sort(key=lambda record: record["itemId"])
    jsonl_path = output_dir / f"search-index-{INDEX_VERSION}.jsonl"
    manifest_path = output_dir / "manifest.json"

    with jsonl_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    manifest = build_manifest(records, jsonl_path)
    manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Wrote {len(records)} records to {jsonl_path}", flush=True)
    print(f"Wrote manifest to {manifest_path}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
