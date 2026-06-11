import type { SearchResponse, SearchResultDocument } from "@/lib/omeka/types";
import type { SearchFilterParams } from "./index-types";
import { searchOmekaLive, type OmekaLiveSearchOptions } from "./omeka-live-search";
import {
  getSemanticSearchTopK,
  searchVectorIndex,
  vectorHitToSearchResult,
} from "./vector-search-client";

const RRF_K = 60;

export interface HybridSearchOptions extends OmekaLiveSearchOptions {
  vectorTopK?: number;
}

function reciprocalRankScore(rank: number, k = RRF_K): number {
  return 1 / (k + rank);
}

function mergeWithReciprocalRankFusion(
  keywordResults: SearchResultDocument[],
  vectorResults: SearchResultDocument[],
): SearchResultDocument[] {
  const fusedScores = new Map<number, number>();
  const documents = new Map<number, SearchResultDocument>();

  keywordResults.forEach((result, index) => {
    fusedScores.set(
      result.itemId,
      (fusedScores.get(result.itemId) ?? 0) + reciprocalRankScore(index + 1),
    );
    documents.set(result.itemId, result);
  });

  vectorResults.forEach((result, index) => {
    fusedScores.set(
      result.itemId,
      (fusedScores.get(result.itemId) ?? 0) + reciprocalRankScore(index + 1),
    );
    const existing = documents.get(result.itemId);
    if (!existing) {
      documents.set(result.itemId, result);
      return;
    }
    documents.set(result.itemId, {
      ...existing,
      snippet: existing.snippet || result.snippet,
      transcriptionPreview:
        existing.transcriptionPreview || result.transcriptionPreview,
      relevanceScore: Math.max(existing.relevanceScore, result.relevanceScore),
      matchedTerms: [...new Set([...existing.matchedTerms, ...result.matchedTerms])],
    });
  });

  return [...documents.values()].sort((left, right) => {
    const leftScore = fusedScores.get(left.itemId) ?? 0;
    const rightScore = fusedScores.get(right.itemId) ?? 0;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    return right.relevanceScore - left.relevanceScore;
  });
}

export async function hybridSearch(
  options: HybridSearchOptions,
): Promise<SearchResponse> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(50, Math.max(1, options.perPage ?? 20));
  const query = options.query?.trim() ?? "";

  const filters: SearchFilterParams = {
    query: options.query,
    yearFrom: options.yearFrom,
    yearTo: options.yearTo,
    decade: options.decade,
    documentType: options.documentType,
    collection: options.collection,
    author: options.author,
    recipient: options.recipient,
    subject: options.subject,
    place: options.place,
    identifier: options.identifier,
  };

  const keywordPromise = searchOmekaLive({
    ...options,
    page: 1,
    perPage: Math.max(perPage * 2, getSemanticSearchTopK()),
    maxResults: Math.max(perPage * 2, getSemanticSearchTopK()),
  });

  const vectorPromise = query
    ? searchVectorIndex(query, filters)
    : Promise.resolve(null);

  const [keywordResponse, vectorResponse] = await Promise.all([
    keywordPromise,
    vectorPromise,
  ]);

  if (!vectorResponse || vectorResponse.results.length === 0) {
    const start = (page - 1) * perPage;
    const pagedResults = keywordResponse.results.slice(start, start + perPage);
    return {
      ...keywordResponse,
      page,
      perPage,
      results: pagedResults,
      totalResults: keywordResponse.totalResults,
    };
  }

  const vectorDocuments = vectorResponse.results.map(vectorHitToSearchResult);
  const merged = mergeWithReciprocalRankFusion(
    keywordResponse.results,
    vectorDocuments,
  );

  const start = (page - 1) * perPage;
  const pagedResults = merged.slice(start, start + perPage);

  return {
    query: keywordResponse.query,
    expandedTerms: keywordResponse.expandedTerms,
    totalResults: merged.length,
    page,
    perPage,
    results: pagedResults,
    facets: keywordResponse.facets,
    searchMode: "hybrid",
    indexBuiltAt: vectorResponse.indexBuiltAt,
    manifestFacets: keywordResponse.manifestFacets,
  };
}

export { mergeWithReciprocalRankFusion, reciprocalRankScore };
