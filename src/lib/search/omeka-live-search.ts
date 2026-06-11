import {
  itemToDocumentFields,
  searchOmekaItemsPage,
  type OmekaSearchFilters,
} from "@/lib/omeka/client";
import type { OmekaItem, SearchResponse } from "@/lib/omeka/types";
import { expandQueryTerms } from "./query-expand";
import { parseQueryIntent, hasCompoundTopicIntent } from "./query-intent";
import type { SearchFilterParams } from "./index-types";
import { hasSearchCriteria, parseSearchFilterParams } from "./search-filters";
import {
  getItemTranscriptionPreview,
  meetsTopicThreshold,
  MIN_RELEVANCE_SCORE,
  scoreDocumentRelevance,
  sortByRelevance,
} from "./scoring";

export class OmekaSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmekaSearchError";
  }
}

function toOmekaFilters(filters: SearchFilterParams): OmekaSearchFilters {
  let yearFrom = filters.yearFrom;
  let yearTo = filters.yearTo;

  if (filters.decade !== undefined) {
    yearFrom = filters.decade;
    yearTo = filters.decade + 9;
  }

  return {
    documentType: filters.documentType,
    collection: filters.collection,
    author: filters.author,
    recipient: filters.recipient,
    subject: filters.subject,
    place: filters.place,
    identifier: filters.identifier,
    yearFrom,
    yearTo,
  };
}

function emptyFacets() {
  return {
    documentTypes: [],
    collections: [],
    decades: [],
    subjects: [],
    places: [],
    creators: [],
  };
}

export interface OmekaLiveSearchOptions extends SearchFilterParams {
  page?: number;
  perPage?: number;
  /** When set, return up to this many scored results instead of slicing to perPage. */
  maxResults?: number;
}

function mapScoredItem(
  item: OmekaItem,
  query: string,
  expandedTerms: string[],
  intent: ReturnType<typeof parseQueryIntent>,
) {
  const fields = itemToDocumentFields(item);
  const scored = scoreDocumentRelevance(item, query, expandedTerms, intent);

  return {
    ...fields,
    snippet: scored.snippet || fields.description || fields.transcriptionPreview,
    relevanceScore: scored.score,
    matchedTerms: scored.matchedTerms,
    transcriptionPreview: getItemTranscriptionPreview(item),
  };
}

export async function searchOmekaLive(
  options: OmekaLiveSearchOptions,
): Promise<SearchResponse> {
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(50, Math.max(1, options.perPage ?? 20));
  const filters = parseSearchFilterParams({
    q: options.query,
    yearFrom: options.yearFrom,
    yearTo: options.yearTo,
    decade: options.decade,
    type: options.documentType,
    collection: options.collection,
    author: options.author,
    recipient: options.recipient,
    subject: options.subject,
    place: options.place,
    identifier: options.identifier,
  });

  if (!hasSearchCriteria(filters)) {
    return {
      query: filters.query ?? "",
      expandedTerms: [],
      totalResults: 0,
      page,
      perPage,
      results: [],
      facets: emptyFacets(),
      searchMode: "keyword",
      indexBuiltAt: null,
      manifestFacets: null,
    };
  }

  const query = filters.query ?? "";
  const expandedTerms = query ? expandQueryTerms(query) : [];
  const intent = query ? parseQueryIntent(query) : parseQueryIntent("");

  try {
    const omekaFilters = toOmekaFilters(filters);
    if (intent.documentTypeHint && !omekaFilters.documentType) {
      omekaFilters.documentType = intent.documentTypeHint;
    }

    const searchQuery = intent.topicQuery || query || expandedTerms[0] || "";
    const oversamplePerPage = Math.min(60, Math.max(perPage, perPage * 3));

    const { items } = await searchOmekaItemsPage(searchQuery, {
      page,
      perPage: oversamplePerPage,
      filters: omekaFilters,
      useFulltext: Boolean(searchQuery),
    });

    const scoredResults = items
      .map((item) => mapScoredItem(item, query, expandedTerms, intent))
      .filter((result) => {
        const item = items.find((entry) => entry["o:id"] === result.itemId);
        if (!item) {
          return false;
        }
        if (!meetsTopicThreshold(item, intent)) {
          return false;
        }
        if (
          hasCompoundTopicIntent(intent) &&
          query &&
          result.relevanceScore < MIN_RELEVANCE_SCORE
        ) {
          return false;
        }
        return true;
      });

    const sortedResults = sortByRelevance(scoredResults);
    const resultLimit = options.maxResults ?? perPage;
    const pagedResults = sortedResults.slice(0, resultLimit);

    return {
      query,
      expandedTerms,
      totalResults: sortedResults.length,
      page,
      perPage,
      results: pagedResults,
      facets: emptyFacets(),
      searchMode: intent.documentTypeHint ? "semantic" : "keyword",
      indexBuiltAt: null,
      manifestFacets: null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Omeka search failed unexpectedly.";
    if (message.includes("abort") || message.includes("timeout")) {
      throw new OmekaSearchError(
        "The Edison Digital catalog is taking too long to respond. Try again or search directly on edisondigital.rutgers.edu.",
      );
    }
    throw new OmekaSearchError(message);
  }
}
