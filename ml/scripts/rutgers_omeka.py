#!/usr/bin/env python3
"""Omeka S API client for Edison Digital (edisondigital.rutgers.edu)."""

from __future__ import annotations

import hashlib
import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator


BASE_URL = "https://edisondigital.rutgers.edu"
SCRIPTOTRANSCRIPTION_PROPERTY_ID = 186
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (compatible; edison-papers-research-omeka/0.1; "
    "+https://edison-papers-research.vercel.app)"
)


@dataclass(frozen=True)
class TranscribedPage:
    media_id: int
    document_id: str
    page_stem: str
    filename: str
    image_url: str
    transcription: str
    width: int
    height: int
    item_id: int | None = None
    document_type: str = ""
    split_bucket: str = ""


@dataclass
class OmekaClient:
    cache_dir: Path
    delay_seconds: float = 0.5
    user_agent: str = DEFAULT_USER_AGENT

    def _cache_path(self, url: str) -> Path:
        digest = hashlib.sha256(url.encode("utf-8")).hexdigest()
        return self.cache_dir / f"{digest}.json"

    def fetch_json(self, url: str) -> Any:
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        path = self._cache_path(url)
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))

        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": self.user_agent,
                "Accept": "application/json, application/ld+json;q=0.9, */*;q=0.1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = response.read().decode("utf-8")
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"HTTP {error.code} while fetching {url}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"Failed to fetch {url}: {error.reason}") from error

        time.sleep(max(self.delay_seconds, 0))
        path.write_text(payload, encoding="utf-8")
        return json.loads(payload)

    def download_binary(self, url: str, path: Path) -> None:
        if path.exists():
            return
        path.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(url, headers={"User-Agent": self.user_agent})
        with urllib.request.urlopen(request, timeout=120) as response:
            path.write_bytes(response.read())
        time.sleep(max(self.delay_seconds, 0))

    def iter_transcribed_media(self, per_page: int = 100) -> Iterator[dict[str, Any]]:
        page = 1
        while True:
            query = urllib.parse.urlencode(
                {
                    "property[0][joiner]": "and",
                    "property[0][property]": str(SCRIPTOTRANSCRIPTION_PROPERTY_ID),
                    "property[0][type]": "ex",
                    "page": str(page),
                    "per_page": str(per_page),
                }
            )
            url = f"{BASE_URL}/api/media?{query}"
            batch = self.fetch_json(url)
            if not batch:
                break
            yield from batch
            if len(batch) < per_page:
                break
            page += 1

    def fetch_item(self, item_id: int) -> dict[str, Any]:
        return self.fetch_json(f"{BASE_URL}/api/items/{item_id}")

    @staticmethod
    def parse_media_record(record: dict[str, Any]) -> TranscribedPage | None:
        transcription_values = record.get("scripto:transcription") or []
        if not transcription_values:
            return None
        text = str(transcription_values[0].get("@value", "")).strip()
        if not text:
            return None

        filename = str(record.get("o:filename") or "")
        if not filename:
            return None
        parts = Path(filename.replace("\\", "/")).parts
        if len(parts) < 2:
            document_id = Path(filename).stem
            page_stem = document_id
        else:
            document_id = parts[-2]
            page_stem = Path(parts[-1]).stem

        image_url = str(record.get("o:original_url") or "")
        if not image_url:
            return None

        dimensions = (record.get("data") or {}).get("dimensions") or {}
        original = dimensions.get("original") or {}
        width = int(original.get("width") or 0)
        height = int(original.get("height") or 0)

        item_ref = record.get("o:item") or {}
        item_id = item_ref.get("o:id")

        bucket_match = re.match(r"^([A-Za-z]+\d*)", document_id)
        split_bucket = bucket_match.group(1) if bucket_match else document_id[:4]

        return TranscribedPage(
            media_id=int(record["o:id"]),
            document_id=document_id,
            page_stem=page_stem,
            filename=filename.replace("\\", "/"),
            image_url=image_url,
            transcription=text,
            width=width,
            height=height,
            item_id=int(item_id) if item_id is not None else None,
            split_bucket=split_bucket,
        )

    def enrich_document_type(self, page: TranscribedPage) -> TranscribedPage:
        if not page.item_id:
            return page
        try:
            item = self.fetch_item(page.item_id)
        except RuntimeError:
            return page
        doc_type = ""
        for entry in item.get("dcterms:type") or []:
            value = str(entry.get("@value", "")).strip()
            if value:
                doc_type = value
                break
        return TranscribedPage(
            media_id=page.media_id,
            document_id=page.document_id,
            page_stem=page.page_stem,
            filename=page.filename,
            image_url=page.image_url,
            transcription=page.transcription,
            width=page.width,
            height=page.height,
            item_id=page.item_id,
            document_type=doc_type,
            split_bucket=page.split_bucket,
        )


def classify_split(document_id: str) -> str:
    digest = int(hashlib.sha1(document_id.encode("utf-8")).hexdigest()[:8], 16)
    bucket = digest % 100
    if bucket < 70:
        return "train"
    if bucket < 85:
        return "validation"
    return "test"


def sample_diverse_pages(
    pages: list[TranscribedPage],
    limit: int,
    seed: int,
) -> list[TranscribedPage]:
    """Stratified round-robin sample across document_id prefix buckets."""
    if len(pages) <= limit:
        return pages

    buckets: dict[str, list[TranscribedPage]] = {}
    for page in pages:
        key = page.split_bucket or page.document_id[:4]
        buckets.setdefault(key, []).append(page)

    rng = random.Random(seed)
    for bucket_pages in buckets.values():
        rng.shuffle(bucket_pages)

    bucket_keys = sorted(buckets.keys())
    rng.shuffle(bucket_keys)

    selected: list[TranscribedPage] = []
    seen_media: set[int] = set()
    while len(selected) < limit and bucket_keys:
        progressed = False
        for key in list(bucket_keys):
            if len(selected) >= limit:
                break
            bucket = buckets.get(key) or []
            while bucket:
                candidate = bucket.pop(0)
                if candidate.media_id in seen_media:
                    continue
                seen_media.add(candidate.media_id)
                selected.append(candidate)
                progressed = True
                break
            if not bucket:
                bucket_keys.remove(key)
        if not progressed:
            break
    return selected


def collect_transcribed_pages(
    client: OmekaClient,
    limit: int,
    seed: int,
    enrich_types: bool = True,
    max_scan: int | None = None,
) -> list[TranscribedPage]:
    """Discover transcribed media and return a diverse sample."""
    if limit <= 0:
        return []

    scan_cap = max_scan if max_scan is not None else max(limit * 50, limit)
    all_pages: list[TranscribedPage] = []
    seen: set[int] = set()
    for record in client.iter_transcribed_media():
        page = client.parse_media_record(record)
        if page is None or page.media_id in seen:
            continue
        seen.add(page.media_id)
        all_pages.append(page)
        if len(all_pages) >= scan_cap:
            break

    sampled = sample_diverse_pages(all_pages, limit, seed)
    if not enrich_types:
        return sampled

    enriched: list[TranscribedPage] = []
    item_cache: dict[int, str] = {}
    for page in sampled:
        if page.item_id and page.item_id in item_cache:
            enriched.append(
                TranscribedPage(
                    media_id=page.media_id,
                    document_id=page.document_id,
                    page_stem=page.page_stem,
                    filename=page.filename,
                    image_url=page.image_url,
                    transcription=page.transcription,
                    width=page.width,
                    height=page.height,
                    item_id=page.item_id,
                    document_type=item_cache[page.item_id],
                    split_bucket=page.split_bucket,
                )
            )
            continue
        updated = client.enrich_document_type(page)
        if updated.item_id and updated.document_type:
            item_cache[updated.item_id] = updated.document_type
        enriched.append(updated)
    return enriched


def collect_unprocessed_transcribed_pages(
    client: OmekaClient,
    processed_media_ids: set[int],
    limit: int,
    seed: int,
    enrich_types: bool = True,
) -> list[TranscribedPage]:
    """Return a diverse sample of transcribed pages not yet in processed_media_ids."""
    if limit <= 0:
        return []

    candidates: list[TranscribedPage] = []
    for record in client.iter_transcribed_media():
        page = client.parse_media_record(record)
        if page is None or page.media_id in processed_media_ids:
            continue
        candidates.append(page)

    sampled = sample_diverse_pages(candidates, limit, seed)
    if not enrich_types:
        return sampled

    enriched: list[TranscribedPage] = []
    item_cache: dict[int, str] = {}
    for page in sampled:
        if page.item_id and page.item_id in item_cache:
            enriched.append(
                TranscribedPage(
                    media_id=page.media_id,
                    document_id=page.document_id,
                    page_stem=page.page_stem,
                    filename=page.filename,
                    image_url=page.image_url,
                    transcription=page.transcription,
                    width=page.width,
                    height=page.height,
                    item_id=page.item_id,
                    document_type=item_cache[page.item_id],
                    split_bucket=page.split_bucket,
                )
            )
            continue
        updated = client.enrich_document_type(page)
        if updated.item_id and updated.document_type:
            item_cache[updated.item_id] = updated.document_type
        enriched.append(updated)
    return enriched
