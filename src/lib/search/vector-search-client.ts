import type { SearchResultDocument } from "@/lib/omeka/types";
import type { SearchFilterParams } from "./index-types";

export interface VectorSearchFilters {
  yearFrom?: number;
  yearTo?: number;
  decade?: number;
  documentType?: string;
  collection?: string;
  author?: string;
  recipient?: string;
  subject?: string;
  place?: string;
  identifier?: string;
}

export interface VectorSearchHit {
  itemId: number;
  title: string;
  description: string;
  documentType: string;
  date: string;
  creator: string;
  identifier: string;
  isPartOf: string;
  subjects: string[];
  thumbnailUrl: string | null;
  edisonDigitalUrl: string;
  snippet: string;
  transcriptionPreview: string;
  score: number;
  chunkType: string;
}

export interface VectorSearchResponse {
  results: VectorSearchHit[];
  indexBuiltAt: string | null;
}

const DEFAULT_TIMEOUT_MS = 8_000;

function getSidecarUrl(): string | null {
  const value = process.env.SEMANTIC_SEARCH_URL?.trim();
  return value || null;
}

function getSidecarSecret(): string | null {
  const value = process.env.SEMANTIC_SEARCH_SECRET?.trim();
  return value || null;
}

function getSidecarHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const secret = getSidecarSecret();
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }
  return headers;
}

function getTimeoutMs(): number {
  const parsed = Number(process.env.SEMANTIC_SEARCH_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

export function getSemanticSearchTopK(): number {
  const parsed = Number(process.env.SEMANTIC_SEARCH_TOP_K ?? 50);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 100) : 50;
}

export function getSemanticSearchMinScore(): number {
  const parsed = Number(process.env.SEMANTIC_SEARCH_MIN_SCORE ?? 0.35);
  return Number.isFinite(parsed) ? parsed : 0.35;
}

export function isSemanticSearchConfigured(): boolean {
  return Boolean(getSidecarUrl());
}

let lastHealthCheck: { at: number; ok: boolean } | null = null;

export async function isSemanticSearchAvailable(): Promise<boolean> {
  const baseUrl = getSidecarUrl();
  if (!baseUrl) {
    return false;
  }

  const now = Date.now();
  if (lastHealthCheck && now - lastHealthCheck.at < 5_000) {
    return lastHealthCheck.ok;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: controller.signal,
      cache: "no-store",
      headers: getSidecarHeaders(),
    });
    const ok = response.ok;
    lastHealthCheck = { at: now, ok };
    return ok;
  } catch {
    lastHealthCheck = { at: now, ok: false };
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function toVectorFilters(filters: SearchFilterParams): VectorSearchFilters {
  return {
    yearFrom: filters.yearFrom,
    yearTo: filters.yearTo,
    decade: filters.decade,
    documentType: filters.documentType,
    collection: filters.collection,
    author: filters.author,
    recipient: filters.recipient,
    subject: filters.subject,
    place: filters.place,
    identifier: filters.identifier,
  };
}

export function vectorHitToSearchResult(hit: VectorSearchHit): SearchResultDocument {
  return {
    itemId: hit.itemId,
    title: hit.title,
    description: hit.description,
    documentType: hit.documentType,
    date: hit.date,
    creator: hit.creator,
    identifier: hit.identifier,
    isPartOf: hit.isPartOf,
    subjects: hit.subjects,
    thumbnailUrl: hit.thumbnailUrl,
    edisonDigitalUrl: hit.edisonDigitalUrl,
    snippet: hit.snippet,
    relevanceScore: hit.score,
    matchedTerms: ["vector"],
    transcriptionPreview: hit.transcriptionPreview,
  };
}

export async function searchVectorIndex(
  query: string,
  filters: SearchFilterParams,
): Promise<VectorSearchResponse | null> {
  const baseUrl = getSidecarUrl();
  if (!baseUrl || !query.trim()) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getTimeoutMs());
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getSidecarHeaders(),
      },
      body: JSON.stringify({
        query,
        topK: getSemanticSearchTopK(),
        minScore: getSemanticSearchMinScore(),
        filters: toVectorFilters(filters),
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as VectorSearchResponse;
    return {
      results: payload.results ?? [],
      indexBuiltAt: payload.indexBuiltAt ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function resetSemanticSearchHealthCache(): void {
  lastHealthCheck = null;
}
