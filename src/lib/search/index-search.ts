import MiniSearch from "minisearch";
import type { SearchResultDocument } from "@/lib/omeka/types";
import type {
  SearchFilterParams,
  SearchIndexManifest,
  SearchIndexRecord,
  SerializedMiniSearchIndex,
} from "./index-types";
import { applyStructuredFilters, countFacets } from "./search-filters";
import { expandQueryTerms } from "./query-expand";

const DEFAULT_MINI_SEARCH_OPTIONS = {
  fields: [
    "title",
    "description",
    "transcriptionText",
    "subjectsText",
    "creatorsText",
    "recipientsText",
    "namesMentionedText",
    "placesText",
    "identifier",
    "isPartOf",
    "documentType",
    "searchableText",
  ],
  storeFields: [
    "itemId",
    "identifier",
    "title",
    "description",
    "documentType",
    "date",
    "dateYear",
    "dateDecade",
    "creators",
    "recipients",
    "namesMentioned",
    "subjects",
    "places",
    "isPartOf",
    "transcriptionText",
    "transcriptionPreview",
    "searchableText",
    "thumbnailUrl",
    "edisonDigitalUrl",
  ] as const,
  searchOptions: {
    boost: {
      title: 3,
      subjectsText: 2.5,
      description: 1.5,
      placesText: 1.5,
      transcriptionText: 1,
      creatorsText: 1,
      identifier: 2,
    },
    prefix: true,
    fuzzy: 0.15,
  },
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSnippet(
  record: SearchIndexRecord,
  query: string,
  expandedTerms: string[],
): string {
  const text = record.transcriptionText || record.description || record.searchableText;
  const normalized = text.replace(/\s+/g, " ").trim();
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
  record: SearchIndexRecord,
  query: string,
  expandedTerms: string[],
): string[] {
  const haystack = record.searchableText.toLowerCase();
  const matched = new Set<string>();

  if (query && haystack.includes(query.toLowerCase())) {
    matched.add(query);
  }

  for (const term of expandedTerms) {
    if (!term) continue;
    const pattern = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    if (pattern.test(haystack)) {
      matched.add(term);
    }
  }

  return [...matched];
}

function recordToSearchResult(
  record: SearchIndexRecord,
  query: string,
  expandedTerms: string[],
  relevanceScore: number,
): SearchResultDocument {
  const snippet = buildSnippet(record, query, expandedTerms);

  return {
    itemId: record.itemId,
    title: record.title,
    description: record.description,
    documentType: record.documentType,
    date: record.date,
    creator: record.creators[0] ?? "",
    identifier: record.identifier,
    isPartOf: record.isPartOf,
    subjects: record.subjects,
    thumbnailUrl: record.thumbnailUrl,
    edisonDigitalUrl: record.edisonDigitalUrl,
    snippet: snippet || record.description || record.transcriptionPreview,
    relevanceScore,
    matchedTerms: collectMatchedTerms(record, query, expandedTerms),
    transcriptionPreview: record.transcriptionPreview,
  };
}

export function createMiniSearchFromSerialized(
  payload: SerializedMiniSearchIndex,
) {
  const options = payload.options ?? DEFAULT_MINI_SEARCH_OPTIONS;
  return MiniSearch.loadJSON(JSON.stringify(payload.index), {
    fields: [...options.fields],
    storeFields: [...options.storeFields],
    idField: "id",
    searchOptions: options.searchOptions ?? DEFAULT_MINI_SEARCH_OPTIONS.searchOptions,
  });
}

export function createMiniSearchFromRecords(records: SearchIndexRecord[]) {
  const miniSearch = new MiniSearch({
    ...DEFAULT_MINI_SEARCH_OPTIONS,
    storeFields: [...DEFAULT_MINI_SEARCH_OPTIONS.storeFields],
    idField: "id",
  });

  const indexed = records.map((record) => ({
    ...record,
    id: String(record.itemId),
    subjectsText: record.subjects.join(" "),
    creatorsText: record.creators.join(" "),
    recipientsText: record.recipients.join(" "),
    namesMentionedText: record.namesMentioned.join(" "),
    placesText: record.places.join(" "),
  }));

  miniSearch.addAll(indexed);
  return miniSearch;
}

export interface IndexSearchInput {
  miniSearch: ReturnType<typeof createMiniSearchFromSerialized>;
  allRecords: SearchIndexRecord[];
  manifest: SearchIndexManifest;
  filters: SearchFilterParams;
  page: number;
  perPage: number;
}

export interface IndexSearchOutput {
  results: SearchResultDocument[];
  totalResults: number;
  expandedTerms: string[];
  facets: ReturnType<typeof countFacets>;
  searchMode: "context" | "browse";
}

export function searchIndex(input: IndexSearchInput): IndexSearchOutput {
  const { miniSearch, allRecords, filters, page, perPage } = input;
  const query = filters.query?.trim() ?? "";
  const expandedTerms = query ? expandQueryTerms(query) : [];

  let candidateRecords: SearchIndexRecord[];
  let scoreByItemId = new Map<number, number>();

  if (query) {
    const searchTerms = [query, ...expandedTerms.filter((term) => term !== query.toLowerCase())];
    const combinedScores = new Map<number, number>();

    for (const term of searchTerms.slice(0, 12)) {
      const hits = miniSearch.search(term, {
        ...DEFAULT_MINI_SEARCH_OPTIONS.searchOptions,
        combineWith: "OR",
      });
      for (const hit of hits) {
        const itemId = Number(hit.id);
        combinedScores.set(itemId, (combinedScores.get(itemId) ?? 0) + hit.score);
      }
    }

    scoreByItemId = combinedScores;
    const hitIds = new Set(combinedScores.keys());
    candidateRecords = allRecords.filter((record) => hitIds.has(record.itemId));
  } else {
    candidateRecords = [...allRecords];
  }

  const filteredRecords = applyStructuredFilters(candidateRecords, filters);

  const results = filteredRecords
    .map((record) =>
      recordToSearchResult(
        record,
        query,
        expandedTerms,
        scoreByItemId.get(record.itemId) ?? (query ? 0 : 1),
      ),
    )
    .sort((left, right) => {
      if (query && right.relevanceScore !== left.relevanceScore) {
        return right.relevanceScore - left.relevanceScore;
      }
      if (left.date && right.date) {
        return left.date.localeCompare(right.date);
      }
      return left.title.localeCompare(right.title);
    });

  const facets = countFacets(filteredRecords);
  const totalResults = results.length;
  const start = (page - 1) * perPage;
  const pagedResults = results.slice(start, start + perPage);

  return {
    results: pagedResults,
    totalResults,
    expandedTerms,
    facets,
    searchMode: query ? "context" : "browse",
  };
}
