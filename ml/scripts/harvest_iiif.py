#!/usr/bin/env python3
"""Harvest Edison Digital IIIF collections and manifests.

The harvester uses public IIIF JSON endpoints rather than rendered HTML pages.
It writes a document inventory CSV and page inventory JSONL that downstream
training scripts can consume.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import html
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


BASE_URL = "https://edisondigital.rutgers.edu"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (compatible; edison-papers-research-iiif-harvester/0.1; "
    "+https://edison-papers-research.vercel.app)"
)
TRANSCRIPT_LABELS = {
    "abstract",
    "body",
    "description",
    "editor's notes",
    "editors notes",
    "full text",
    "text",
    "transcript",
    "transcription",
}

DOCUMENT_FIELDS = [
    "document_id",
    "folder_id",
    "title",
    "date",
    "document_type",
    "authors",
    "mentioned_names",
    "subjects",
    "page_count",
    "rights",
    "license",
    "iiif_manifest_url",
    "source_url",
    "archive_url",
    "local_image_dir",
    "transcript_status",
    "transcript_source",
    "transcript_path",
    "split",
    "notes",
    "exclude_from_training",
]


@dataclass(frozen=True)
class HarvestConfig:
    cache_dir: Path
    documents_csv: Path
    pages_jsonl: Path
    delay_seconds: float
    user_agent: str
    download_images: bool
    raw_dir: Path
    transcripts_dir: Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--seed-file",
        type=Path,
        default=Path("ml/configs/rutgers_seed_folders.txt"),
        help="Text file containing folder IDs or document IDs, one per line.",
    )
    parser.add_argument(
        "--no-seed-file",
        action="store_true",
        help="Ignore the default seed file and use only --seed values.",
    )
    parser.add_argument(
        "--seed",
        action="append",
        default=[],
        help="Additional folder/document ID or IIIF URL. May be passed multiple times.",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=Path("ml/data/cache/iiif"),
        help="Directory for cached IIIF JSON responses.",
    )
    parser.add_argument(
        "--documents-csv",
        type=Path,
        default=Path("ml/data/manifests/documents.csv"),
        help="Output document inventory CSV.",
    )
    parser.add_argument(
        "--pages-jsonl",
        type=Path,
        default=Path("ml/data/manifests/pages.jsonl"),
        help="Output page inventory JSONL.",
    )
    parser.add_argument(
        "--raw-dir",
        type=Path,
        default=Path("ml/data/raw"),
        help="Local image path root used in page inventory rows.",
    )
    parser.add_argument(
        "--transcripts-dir",
        type=Path,
        default=Path("ml/data/transcripts"),
        help="Directory for transcript candidates extracted from IIIF metadata.",
    )
    parser.add_argument(
        "--download-images",
        action="store_true",
        help="Download original page images into raw-dir.",
    )
    parser.add_argument(
        "--delay-seconds",
        type=float,
        default=0.5,
        help="Delay between uncached network requests.",
    )
    parser.add_argument(
        "--user-agent",
        default=DEFAULT_USER_AGENT,
        help="HTTP User-Agent sent to Edison Digital.",
    )
    return parser.parse_args()


def read_seeds(seed_file: Path, explicit_seeds: list[str]) -> list[str]:
    seeds: list[str] = []
    if seed_file.exists():
        for line in seed_file.read_text(encoding="utf-8").splitlines():
            cleaned = line.strip()
            if cleaned and not cleaned.startswith("#"):
                seeds.append(cleaned)
    seeds.extend(seed.strip() for seed in explicit_seeds if seed.strip())
    return list(dict.fromkeys(seeds))


def seed_to_url(seed: str) -> str:
    if seed.startswith("http://") or seed.startswith("https://"):
        return seed
    return f"{BASE_URL}/iiif/{seed}"


def fallback_urls(url: str) -> list[str]:
    if not url.startswith(f"{BASE_URL}/iiif/"):
        return []
    identifier = url.rstrip("/").split("/")[-1]
    if not identifier or identifier in {"iiif", "manifest"}:
        return []
    if identifier.endswith("-F"):
        return [f"{BASE_URL}/iiif/2/collection/{identifier}"]
    return [f"{BASE_URL}/iiif/2/{identifier}/manifest"]


def cache_path(cache_dir: Path, url: str) -> Path:
    digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
    return cache_dir / f"{digest}.json"


def fetch_json(url: str, config: HarvestConfig) -> Any:
    config.cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_path(config.cache_dir, url)
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": config.user_agent,
            "Accept": "application/json, application/ld+json;q=0.9, */*;q=0.1",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=45) as response:
            payload = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"HTTP {error.code} while fetching {url}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Failed to fetch {url}: {error.reason}") from error

    time.sleep(max(config.delay_seconds, 0))
    path.write_text(payload, encoding="utf-8")
    return json.loads(payload)


def download_binary(url: str, path: Path, config: HarvestConfig) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": config.user_agent})
    with urllib.request.urlopen(request, timeout=60) as response:
        path.write_bytes(response.read())
    time.sleep(max(config.delay_seconds, 0))


def strip_html(value: Any) -> str:
    if isinstance(value, list):
        return "; ".join(strip_html(item) for item in value if strip_html(item))
    text = html.unescape(str(value or ""))
    text = re.sub(r"<[^>]+>", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def metadata_map(manifest: dict[str, Any]) -> dict[str, str]:
    result: dict[str, str] = {}
    for item in manifest.get("metadata", []):
        label = strip_html(item.get("label"))
        value = strip_html(item.get("value"))
        if label:
            result[label.lower()] = value
    return result


def transcript_candidate(manifest: dict[str, Any]) -> tuple[str, str]:
    """Return the best transcript-like metadata value and its source label.

    Edison Digital manifests are not uniform: some documents expose human text as
    "Editor's Notes" or "Abstract" while others only contain descriptive metadata.
    We keep these candidates as document-level transcript drafts for later PAGE
    XML alignment rather than treating them as line-level ground truth.
    """
    for item in manifest.get("metadata", []):
        label = strip_html(item.get("label"))
        normalized = label.lower()
        if normalized in TRANSCRIPT_LABELS:
            value = strip_html(item.get("value"))
            if value:
                return value, label
    return "", ""


def write_transcript_candidate(
    manifest: dict[str, Any],
    document_id: str,
    transcripts_dir: Path,
) -> tuple[str, str, str]:
    transcript_path = transcripts_dir / f"{document_id}.txt"
    if transcript_path.exists():
        return "available", "local:existing", str(transcript_path).replace("\\", "/")

    text, source = transcript_candidate(manifest)
    if not text:
        return "missing", "", ""
    transcripts_dir.mkdir(parents=True, exist_ok=True)
    transcript_path.write_text(text.rstrip() + "\n", encoding="utf-8")
    return "available", f"iiif:{source}", str(transcript_path).replace("\\", "/")


def extract_href(value: Any) -> str:
    text = html.unescape(str(value or ""))
    match = re.search(r'href="([^"]+)"', text)
    if match:
        return match.group(1)
    return strip_html(value)


def metadata_href(manifest: dict[str, Any], label: str) -> str:
    for item in manifest.get("metadata", []):
        if strip_html(item.get("label")).lower() == label.lower():
            return extract_href(item.get("value"))
    return ""


def document_id_from_manifest_url(url: str) -> str:
    match = re.search(r"/iiif/(?:2/)?([^/]+)/manifest", url)
    if match:
        return match.group(1)
    return url.rstrip("/").split("/")[-1]


def canonical_manifest_url(url: str) -> str:
    document_id = document_id_from_manifest_url(url)
    return f"{BASE_URL}/iiif/{document_id}"


def iter_collection_manifest_urls(collection: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for manifest in collection.get("manifests", []):
        manifest_url = manifest.get("@id") or manifest.get("id")
        if isinstance(manifest_url, str):
            urls.append(canonical_manifest_url(manifest_url))
    return urls


def iter_canvases(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    canvases: list[dict[str, Any]] = []
    for sequence in manifest.get("sequences", []):
        canvases.extend(sequence.get("canvases", []))
    return canvases


def image_resource(canvas: dict[str, Any]) -> dict[str, Any] | None:
    images = canvas.get("images") or []
    if not images:
        return None
    resource = images[0].get("resource")
    return resource if isinstance(resource, dict) else None


def classify_split(document_id: str) -> str:
    digest = int(hashlib.sha1(document_id.encode("utf-8")).hexdigest()[:8], 16)
    bucket = digest % 100
    if bucket < 70:
        return "train"
    if bucket < 85:
        return "validation"
    return "test"


def document_row(
    manifest: dict[str, Any],
    manifest_url: str,
    pages: list[dict[str, Any]],
    raw_dir: Path,
    transcripts_dir: Path,
) -> dict[str, str]:
    meta = metadata_map(manifest)
    document_id = meta.get("document id") or document_id_from_manifest_url(manifest_url)
    folder_value = meta.get("folder id", "")
    folder_id_match = re.search(r"\[([^\]]+)\]", folder_value)
    folder_id = folder_id_match.group(1) if folder_id_match else folder_value
    source_url = metadata_href(manifest, "URL") or f"{BASE_URL}/document/{document_id}"
    archive_url = metadata_href(manifest, "Has Version")
    local_image_dir = str(raw_dir / document_id).replace("\\", "/")
    transcript_status, transcript_source, transcript_path = write_transcript_candidate(
        manifest,
        document_id,
        transcripts_dir,
    )
    source_lower = transcript_source.lower()
    exclude_from_training = "yes" if source_lower.startswith("iiif:abstract") or source_lower in {
        "iiif:description",
        "iiif:editor's notes",
        "iiif:editors notes",
    } else "no"
    return {
        "document_id": document_id,
        "folder_id": folder_id,
        "title": meta.get("title", strip_html(manifest.get("label"))),
        "date": meta.get("date", ""),
        "document_type": meta.get("type", ""),
        "authors": meta.get("author", ""),
        "mentioned_names": meta.get("mentioned", ""),
        "subjects": meta.get("subject", ""),
        "page_count": str(len(pages)),
        "rights": meta.get("rights", ""),
        "license": meta.get("license", ""),
        "iiif_manifest_url": manifest_url,
        "source_url": source_url,
        "archive_url": archive_url,
        "local_image_dir": local_image_dir,
        "transcript_status": transcript_status,
        "transcript_source": transcript_source,
        "transcript_path": transcript_path,
        "split": classify_split(document_id),
        "notes": "",
        "exclude_from_training": exclude_from_training,
    }


def page_rows(
    manifest: dict[str, Any],
    manifest_url: str,
    raw_dir: Path,
) -> list[dict[str, Any]]:
    meta = metadata_map(manifest)
    document_id = meta.get("document id") or document_id_from_manifest_url(manifest_url)
    rows: list[dict[str, Any]] = []
    for index, canvas in enumerate(iter_canvases(manifest)):
        resource = image_resource(canvas)
        if not resource:
            continue
        image_url = resource.get("@id") or resource.get("id")
        if not isinstance(image_url, str) or "placeholder" in image_url:
            continue
        extension = Path(urllib.parse.urlparse(image_url).path).suffix or ".jpg"
        local_path = raw_dir / document_id / f"page_{index + 1:04d}{extension}"
        rows.append(
            {
                "document_id": document_id,
                "page_index": index,
                "source_page": strip_html(canvas.get("label")) or str(index + 1),
                "image_url": image_url,
                "width": resource.get("width") or canvas.get("width"),
                "height": resource.get("height") or canvas.get("height"),
                "local_path": str(local_path).replace("\\", "/"),
            }
        )
    return rows


def harvest(seeds: list[str], config: HarvestConfig) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    pending = [seed_to_url(seed) for seed in seeds]
    seen_urls: set[str] = set()
    document_rows: list[dict[str, str]] = []
    all_page_rows: list[dict[str, Any]] = []

    while pending:
        url = pending.pop(0)
        if url in seen_urls:
            continue
        seen_urls.add(url)
        try:
            payload = fetch_json(url, config)
        except RuntimeError:
            fallbacks = fallback_urls(url)
            if not fallbacks:
                raise
            payload = fetch_json(fallbacks[0], config)
        payload_type = payload.get("@type") or payload.get("type")

        if payload_type == "sc:Collection":
            pending.extend(
                manifest_url for manifest_url in iter_collection_manifest_urls(payload)
                if manifest_url not in seen_urls
            )
            continue

        if payload_type != "sc:Manifest":
            print(f"Skipping unsupported IIIF payload at {url}: {payload_type}", file=sys.stderr)
            continue

        manifest_url = canonical_manifest_url(url)
        pages = page_rows(payload, manifest_url, config.raw_dir)
        if config.download_images:
            for page in pages:
                download_binary(page["image_url"], Path(page["local_path"]), config)
        document_rows.append(
            document_row(
                payload,
                manifest_url,
                pages,
                config.raw_dir,
                config.transcripts_dir,
            )
        )
        all_page_rows.extend(pages)

    document_rows.sort(key=lambda row: row["document_id"])
    all_page_rows.sort(key=lambda row: (row["document_id"], row["page_index"]))
    return document_rows, all_page_rows


def write_outputs(documents: list[dict[str, str]], pages: list[dict[str, Any]], config: HarvestConfig) -> None:
    config.documents_csv.parent.mkdir(parents=True, exist_ok=True)
    config.pages_jsonl.parent.mkdir(parents=True, exist_ok=True)
    with config.documents_csv.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=DOCUMENT_FIELDS)
        writer.writeheader()
        writer.writerows(documents)
    with config.pages_jsonl.open("w", encoding="utf-8") as handle:
        for row in pages:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")


def main() -> int:
    args = parse_args()
    seed_file = Path("__missing_seed_file__") if args.no_seed_file else args.seed_file
    seeds = read_seeds(seed_file, args.seed)
    if not seeds:
        print("No seeds provided. Add folder/document IDs with --seed-file or --seed.", file=sys.stderr)
        return 2

    config = HarvestConfig(
        cache_dir=args.cache_dir,
        documents_csv=args.documents_csv,
        pages_jsonl=args.pages_jsonl,
        delay_seconds=args.delay_seconds,
        user_agent=args.user_agent,
        download_images=args.download_images,
        raw_dir=args.raw_dir,
        transcripts_dir=args.transcripts_dir,
    )
    documents, pages = harvest(seeds, config)
    write_outputs(documents, pages, config)
    print(f"Wrote {len(documents)} documents to {config.documents_csv}")
    print(f"Wrote {len(pages)} pages to {config.pages_jsonl}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
