import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { head } from "@vercel/blob";
import { getAppEnv } from "@/lib/edison/env";
import type {
  SearchIndexManifest,
  SearchIndexRecord,
  SerializedMiniSearchIndex,
} from "./index-types";
import {
  BLOB_JSONL_PATH,
  BLOB_MANIFEST_PATH,
  BLOB_MINISEARCH_PATH,
  LOCAL_JSONL_PATH,
  LOCAL_MANIFEST_PATH,
  LOCAL_MINISEARCH_PATH,
} from "./index-types";
import { createMiniSearchFromSerialized } from "./index-search";

const CACHE_TTL_MS = 15 * 60 * 1000;

interface LoadedSearchIndex {
  manifest: SearchIndexManifest;
  miniSearch: ReturnType<typeof createMiniSearchFromSerialized>;
  allRecords: SearchIndexRecord[];
  loadedAt: number;
  source: "blob" | "local";
}

let cachedIndex: LoadedSearchIndex | null = null;

function getRepoRoot(): string {
  return process.cwd();
}

async function fetchJsonFromUrl<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch search index (${response.status}) from ${url}`);
  }
  return (await response.json()) as T;
}

function readLocalJson<T>(relativePath: string): T {
  const absolutePath = join(getRepoRoot(), relativePath);
  return JSON.parse(readFileSync(absolutePath, "utf-8")) as T;
}

async function fetchTextFromUrl(url: string): Promise<string> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch search index (${response.status}) from ${url}`);
  }
  return response.text();
}

async function parseJsonl(text: string): Promise<SearchIndexRecord[]> {
  const records: SearchIndexRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    records.push(JSON.parse(trimmed) as SearchIndexRecord);
  }
  return records.sort((left, right) => left.itemId - right.itemId);
}

async function readLocalJsonl(relativePath: string): Promise<SearchIndexRecord[]> {
  const absolutePath = join(getRepoRoot(), relativePath);
  const records: SearchIndexRecord[] = [];
  const stream = createReadStream(absolutePath, { encoding: "utf-8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    records.push(JSON.parse(trimmed) as SearchIndexRecord);
  }

  return records.sort((left, right) => left.itemId - right.itemId);
}

async function loadFromBlob(): Promise<LoadedSearchIndex | null> {
  const env = getAppEnv();
  if (!env.BLOB_READ_WRITE_TOKEN) {
    return null;
  }

  try {
    const [manifestMeta, miniSearchMeta, jsonlMeta] = await Promise.all([
      head(BLOB_MANIFEST_PATH),
      head(BLOB_MINISEARCH_PATH),
      head(BLOB_JSONL_PATH),
    ]);
    const [manifest, serialized, jsonlText] = await Promise.all([
      fetchJsonFromUrl<SearchIndexManifest>(manifestMeta.url),
      fetchJsonFromUrl<SerializedMiniSearchIndex>(miniSearchMeta.url),
      fetchTextFromUrl(jsonlMeta.url),
    ]);

    const miniSearch = createMiniSearchFromSerialized(serialized);
    const allRecords = await parseJsonl(jsonlText);

    return {
      manifest,
      miniSearch,
      allRecords,
      loadedAt: Date.now(),
      source: "blob",
    };
  } catch {
    return null;
  }
}

async function loadFromLocal(): Promise<LoadedSearchIndex | null> {
  try {
    const manifest = readLocalJson<SearchIndexManifest>(LOCAL_MANIFEST_PATH);
    const serialized = readLocalJson<SerializedMiniSearchIndex>(LOCAL_MINISEARCH_PATH);
    const miniSearch = createMiniSearchFromSerialized(serialized);
    const allRecords = await readLocalJsonl(LOCAL_JSONL_PATH);

    return {
      manifest,
      miniSearch,
      allRecords,
      loadedAt: Date.now(),
      source: "local",
    };
  } catch {
    return null;
  }
}

export class SearchIndexUnavailableError extends Error {
  constructor(message = "Search index is not available. Run npm run search:build and upload the index.") {
    super(message);
    this.name = "SearchIndexUnavailableError";
  }
}

export async function getSearchIndex(forceReload = false): Promise<LoadedSearchIndex> {
  if (
    !forceReload &&
    cachedIndex &&
    Date.now() - cachedIndex.loadedAt < CACHE_TTL_MS
  ) {
    return cachedIndex;
  }

  const blobIndex = await loadFromBlob();
  if (blobIndex) {
    cachedIndex = blobIndex;
    return blobIndex;
  }

  const localIndex = await loadFromLocal();
  if (localIndex) {
    cachedIndex = localIndex;
    return localIndex;
  }

  throw new SearchIndexUnavailableError();
}

export function clearSearchIndexCache(): void {
  cachedIndex = null;
}

export type LoadedIndex = LoadedSearchIndex;
