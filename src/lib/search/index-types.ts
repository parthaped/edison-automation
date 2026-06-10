export interface FacetEntry {
  value: string;
  count: number;
}

export interface SearchIndexRecord {
  itemId: number;
  identifier: string;
  title: string;
  description: string;
  documentType: string;
  date: string;
  dateYear: number | null;
  dateDecade: number | null;
  creators: string[];
  recipients: string[];
  namesMentioned: string[];
  subjects: string[];
  places: string[];
  isPartOf: string;
  transcriptionText: string;
  transcriptionPreview: string;
  searchableText: string;
  thumbnailUrl: string | null;
  edisonDigitalUrl: string;
}

export interface SearchIndexManifest {
  version: string;
  builtAt: string;
  recordCount: number;
  checksum?: string;
  jsonlPath?: string;
  miniSearchPath?: string;
  facets: {
    documentTypes: FacetEntry[];
    collections: FacetEntry[];
    decades: FacetEntry[];
    subjects: FacetEntry[];
    places: FacetEntry[];
    creators: FacetEntry[];
  };
}

export interface SerializedMiniSearchIndex {
  options: {
    fields: string[];
    storeFields: string[];
    searchOptions?: {
      boost?: Record<string, number>;
      prefix?: boolean;
      fuzzy?: number;
    };
  };
  index: Record<string, unknown>;
}

export interface SearchFilterParams {
  query?: string;
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

export interface SearchFacets {
  documentTypes: FacetEntry[];
  collections: FacetEntry[];
  decades: FacetEntry[];
  subjects: FacetEntry[];
  places: FacetEntry[];
  creators: FacetEntry[];
}

export const INDEX_VERSION = "v1";
export const BLOB_MANIFEST_PATH = "search/manifest.json";
export const BLOB_JSONL_PATH = `search/index-${INDEX_VERSION}.jsonl`;
export const BLOB_MINISEARCH_PATH = `search/index-${INDEX_VERSION}.minisearch.json`;

export const LOCAL_SEARCH_DIR = "ml/data/search";
export const LOCAL_MANIFEST_PATH = `${LOCAL_SEARCH_DIR}/manifest.json`;
export const LOCAL_JSONL_PATH = `${LOCAL_SEARCH_DIR}/search-index-${INDEX_VERSION}.jsonl`;
export const LOCAL_MINISEARCH_PATH = `${LOCAL_SEARCH_DIR}/search-index-${INDEX_VERSION}.minisearch.json`;
