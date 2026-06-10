import type { SearchResponse } from "@/lib/omeka/types";
import type { SearchFilterParams } from "./index-types";
import { hasSearchCriteria, parseSearchFilterParams } from "./search-filters";
import { searchOmekaLive } from "./omeka-live-search";

export interface SemanticSearchOptions extends SearchFilterParams {
  page?: number;
  perPage?: number;
}

export async function semanticSearch(
  options: SemanticSearchOptions,
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
      facets: {
        documentTypes: [],
        collections: [],
        decades: [],
        subjects: [],
        places: [],
        creators: [],
      },
      searchMode: "keyword",
      indexBuiltAt: null,
      manifestFacets: null,
    };
  }

  return searchOmekaLive({ ...options, page, perPage });
}
