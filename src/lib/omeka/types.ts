/** Omeka S JSON-LD value entry. */
export interface OmekaValue {
  type?: string;
  property_id?: number;
  property_label?: string;
  is_public?: boolean;
  "@value"?: string;
  "@language"?: string | null;
  value_resource_id?: number | null;
  value_resource_name?: string | null;
  url?: string | null;
  thumbnail_url?: string | null;
}

export interface OmekaResourceRef {
  "@id"?: string;
  "o:id"?: number;
  "o:label"?: string;
}

export interface OmekaItem {
  "@context"?: string;
  "@id"?: string;
  "@type"?: string[];
  "o:id": number;
  "o:is_public"?: boolean;
  "o:owner"?: OmekaResourceRef | null;
  "o:resource_class"?: OmekaResourceRef | null;
  "o:thumbnail"?: OmekaResourceRef | null;
  "o:title"?: string;
  "o:created"?: OmekaValue;
  "o:modified"?: OmekaValue;
  "thumbnail_display_urls"?: Record<string, string>;
  "o:media"?: OmekaResourceRef[];
  "dcterms:title"?: OmekaValue[];
  "dcterms:description"?: OmekaValue[];
  "dcterms:creator"?: OmekaValue[];
  "dcterms:date"?: OmekaValue[];
  "dcterms:type"?: OmekaValue[];
  "dcterms:subject"?: OmekaValue[];
  "dcterms:identifier"?: OmekaValue[];
  "dcterms:isPartOf"?: OmekaValue[];
  "dcterms:source"?: OmekaValue[];
  "dcterms:language"?: OmekaValue[];
  "dcterms:relation"?: OmekaValue[];
  "dcterms:coverage"?: OmekaValue[];
  "dcterms:contributor"?: OmekaValue[];
  "dcterms:publisher"?: OmekaValue[];
  "dcterms:rights"?: OmekaValue[];
  "scripto:transcription"?: OmekaValue[];
  [key: string]: unknown;
}

export interface OmekaMedia {
  "@context"?: string;
  "@id"?: string;
  "@type"?: string[];
  "o:id": number;
  "o:filename"?: string;
  "o:original_url"?: string;
  "o:thumbnail_urls"?: Record<string, string>;
  "o:item"?: OmekaResourceRef;
  "o:media_type"?: string;
  "scripto:transcription"?: OmekaValue[];
  [key: string]: unknown;
}

export interface SearchResultDocument {
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
  iiifManifestUrl?: string | null;
  snippet: string;
  relevanceScore: number;
  matchedTerms: string[];
  transcriptionPreview: string;
}

export interface SearchFacets {
  documentTypes: Array<{ value: string; count: number }>;
  collections: Array<{ value: string; count: number }>;
  decades: Array<{ value: string; count: number }>;
  subjects: Array<{ value: string; count: number }>;
  places: Array<{ value: string; count: number }>;
  creators: Array<{ value: string; count: number }>;
}

export interface SearchResponse {
  query: string;
  expandedTerms: string[];
  totalResults: number;
  page: number;
  perPage: number;
  results: SearchResultDocument[];
  facets: SearchFacets;
  searchMode: "semantic" | "keyword";
  indexBuiltAt?: string | null;
  manifestFacets?: SearchIndexManifestFacets | null;
}

export interface SearchIndexManifestFacets {
  documentTypes: Array<{ value: string; count: number }>;
  collections: Array<{ value: string; count: number }>;
  decades: Array<{ value: string; count: number }>;
  subjects: Array<{ value: string; count: number }>;
  places: Array<{ value: string; count: number }>;
  creators: Array<{ value: string; count: number }>;
}
