import {
  getFirstValue,
  itemToDocumentFields,
  searchOmekaItemsPage,
  type OmekaSearchFilters,
} from "@/lib/omeka/client";
import type { OmekaItem, SearchResponse } from "@/lib/omeka/types";
import { expandQueryTerms } from "./query-expand";
import type { SearchFilterParams } from "./index-types";
import { hasSearchCriteria, parseSearchFilterParams } from "./search-filters";

export class OmekaSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OmekaSearchError";
  }
}

function buildSnippet(
  searchableText: string,
  query: string,
  expandedTerms: string[],
): string {
  const normalized = searchableText.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }

  const lower = normalized.toLowerCase();
  const needles = [query.toLowerCase(), ...expandedTerms].filter(Boolean);

  let bestIndex = -1;
  for (const needle of needles) {
    const index = lower.indexOf(needle);
    if (index !== -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
    }
  }

  const contextRadius = 160;
  const start = bestIndex === -1 ? 0 : Math.max(0, bestIndex - 60);
  const end = Math.min(normalized.length, start + contextRadius);
  let snippet = normalized.slice(start, end).trim();

  if (start > 0) {
    snippet = `…${snippet}`;
  }
  if (end < normalized.length) {
    snippet = `${snippet}…`;
  }

  return snippet;
}

function collectMatchedTerms(
  haystack: string,
  query: string,
  expandedTerms: string[],
): string[] {
  const lower = haystack.toLowerCase();
  const matched = new Set<string>();

  if (query && lower.includes(query.toLowerCase())) {
    matched.add(query);
  }

  for (const term of expandedTerms) {
    if (term && lower.includes(term.toLowerCase())) {
      matched.add(term);
    }
  }

  return [...matched];
}

function itemSearchableText(item: OmekaItem): string {
  const fields = itemToDocumentFields(item);
  const transcription =
    getFirstValue(item["scripto:transcription"]) || fields.transcriptionPreview;
  return [
    fields.title,
    fields.description,
    fields.documentType,
    fields.date,
    fields.creator,
    fields.identifier,
    fields.isPartOf,
    ...fields.subjects,
    transcription,
  ]
    .filter(Boolean)
    .join(" ");
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

  try {
    const omekaFilters = toOmekaFilters(filters);
    const searchQuery = query || expandedTerms[0] || "";
    const { items, totalResults } = await searchOmekaItemsPage(searchQuery, {
      page,
      perPage,
      filters: omekaFilters,
      useFulltext: Boolean(query),
    });

    const results = items.map((item) => {
      const fields = itemToDocumentFields(item);
      const searchableText = itemSearchableText(item);
      return {
        ...fields,
        snippet: buildSnippet(searchableText, query, expandedTerms),
        relevanceScore: 1,
        matchedTerms: collectMatchedTerms(searchableText, query, expandedTerms),
      };
    });

    return {
      query,
      expandedTerms,
      totalResults,
      page,
      perPage,
      results,
      facets: emptyFacets(),
      searchMode: "keyword",
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
