import { getAppEnv } from "@/lib/edison/env";
import { APP_USER_AGENT } from "@/lib/app-config";
import type { OmekaItem, OmekaMedia, OmekaValue } from "./types";

const DEFAULT_SITE_URL = "https://edisondigital.rutgers.edu";
const USER_AGENT = APP_USER_AGENT;

export function getOmekaApiBaseUrl(env = getAppEnv()): string {
  return env.OMEKA_API_BASE_URL.replace(/\/$/, "");
}

export function getEdisonDigitalSiteUrl(): string {
  return DEFAULT_SITE_URL;
}

export function getItemPublicUrl(itemId: number): string {
  return `${DEFAULT_SITE_URL}/s/omeka/page/taep-item/${itemId}`;
}

export function getValueStrings(values: OmekaValue[] | undefined): string[] {
  if (!values?.length) {
    return [];
  }
  return values
    .map((entry) => String(entry["@value"] ?? "").trim())
    .filter(Boolean);
}

export function getFirstValue(values: OmekaValue[] | undefined): string {
  return getValueStrings(values)[0] ?? "";
}

export function extractSearchableText(item: OmekaItem): string {
  const parts = [
    item["o:title"],
    ...getValueStrings(item["dcterms:title"]),
    ...getValueStrings(item["dcterms:description"]),
    ...getValueStrings(item["dcterms:subject"]),
    ...getValueStrings(item["dcterms:identifier"]),
    ...getValueStrings(item["dcterms:isPartOf"]),
    ...getValueStrings(item["dcterms:creator"]),
    ...getValueStrings(item["dcterms:date"]),
    ...getValueStrings(item["dcterms:type"]),
    ...getValueStrings(item["scripto:transcription"]),
  ];
  return parts.filter(Boolean).join(" ");
}

const OMEKA_SEARCH_TIMEOUT_MS = 25_000;

export interface OmekaSearchFilters {
  documentType?: string;
  collection?: string;
  author?: string;
  recipient?: string;
  subject?: string;
  place?: string;
  identifier?: string;
  yearFrom?: number;
  yearTo?: number;
}

function appendPropertyFilter(
  params: Record<string, string>,
  index: number,
  property: string,
  type: string,
  text: string,
): number {
  params[`property[${index}][joiner]`] = "and";
  params[`property[${index}][property]`] = property;
  params[`property[${index}][type]`] = type;
  params[`property[${index}][text]`] = text;
  return index + 1;
}

export function buildOmekaSearchParams(
  query: string,
  options: {
    page?: number;
    perPage?: number;
    filters?: OmekaSearchFilters;
    useFulltext?: boolean;
  } = {},
): Record<string, string> {
  const params: Record<string, string> = {
    page: String(options.page ?? 1),
    per_page: String(options.perPage ?? 25),
  };

  if (options.useFulltext !== false && query.trim()) {
    params.fulltext_search = query.trim();
  }

  const filters = options.filters ?? {};
  let propertyIndex = 0;

  if (filters.documentType) {
    propertyIndex = appendPropertyFilter(
      params,
      propertyIndex,
      "dcterms:type",
      "in",
      filters.documentType,
    );
  }
  if (filters.collection) {
    propertyIndex = appendPropertyFilter(
      params,
      propertyIndex,
      "dcterms:isPartOf",
      "in",
      filters.collection,
    );
  }
  if (filters.author) {
    propertyIndex = appendPropertyFilter(
      params,
      propertyIndex,
      "dcterms:creator",
      "in",
      filters.author,
    );
  }
  if (filters.recipient) {
    propertyIndex = appendPropertyFilter(
      params,
      propertyIndex,
      "bibo:recipient",
      "in",
      filters.recipient,
    );
  }
  if (filters.subject) {
    propertyIndex = appendPropertyFilter(
      params,
      propertyIndex,
      "dcterms:subject",
      "in",
      filters.subject,
    );
  }
  if (filters.place) {
    propertyIndex = appendPropertyFilter(
      params,
      propertyIndex,
      "dcterms:coverage",
      "in",
      filters.place,
    );
  }
  if (filters.identifier) {
    propertyIndex = appendPropertyFilter(
      params,
      propertyIndex,
      "dcterms:identifier",
      "eq",
      filters.identifier,
    );
  }
  if (filters.yearFrom !== undefined) {
    propertyIndex = appendPropertyFilter(
      params,
      propertyIndex,
      "dcterms:date",
      "gte",
      String(filters.yearFrom),
    );
  }
  if (filters.yearTo !== undefined) {
    appendPropertyFilter(
      params,
      propertyIndex,
      "dcterms:date",
      "lte",
      String(filters.yearTo),
    );
  }

  return params;
}

export async function fetchOmekaJson<T>(
  path: string,
  params?: Record<string, string>,
  fetchOptions?: { signal?: AbortSignal },
): Promise<T> {
  const baseUrl = getOmekaApiBaseUrl();
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json, application/ld+json;q=0.9, */*;q=0.1",
      "User-Agent": USER_AGENT,
    },
    next: { revalidate: 300 },
    signal: fetchOptions?.signal,
  });

  if (!response.ok) {
    throw new Error(`Omeka API error ${response.status} for ${url.pathname}`);
  }

  return (await response.json()) as T;
}

export interface OmekaItemsPageResult {
  items: OmekaItem[];
  totalResults: number;
  page: number;
  perPage: number;
}

export async function searchOmekaItemsPage(
  query: string,
  options: {
    page?: number;
    perPage?: number;
    filters?: OmekaSearchFilters;
    useFulltext?: boolean;
  } = {},
): Promise<OmekaItemsPageResult> {
  const page = options.page ?? 1;
  const perPage = options.perPage ?? 25;
  const params = buildOmekaSearchParams(query, { ...options, page, perPage });
  const baseUrl = getOmekaApiBaseUrl();
  const url = new URL(`${baseUrl}/items`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json, application/ld+json;q=0.9, */*;q=0.1",
      "User-Agent": USER_AGENT,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(OMEKA_SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Omeka API error ${response.status} for /items`);
  }

  const totalHeader = response.headers.get("Omeka-S-Total-Results");
  const totalResults = totalHeader ? Number(totalHeader) : 0;
  const items = (await response.json()) as OmekaItem[];

  return {
    items,
    totalResults: Number.isFinite(totalResults) ? totalResults : items.length,
    page,
    perPage,
  };
}

export async function searchOmekaItems(
  query: string,
  options: { page?: number; perPage?: number } = {},
): Promise<OmekaItem[]> {
  const page = String(options.page ?? 1);
  const perPage = String(options.perPage ?? 25);

  return fetchOmekaJson<OmekaItem[]>("/items", {
    fulltext_search: query,
    page,
    per_page: perPage,
  });
}

export async function searchOmekaMedia(
  query: string,
  options: { page?: number; perPage?: number } = {},
): Promise<OmekaMedia[]> {
  const page = String(options.page ?? 1);
  const perPage = String(options.perPage ?? 25);

  return fetchOmekaJson<OmekaMedia[]>("/media", {
    fulltext_search: query,
    page,
    per_page: perPage,
  });
}

export async function fetchOmekaItem(itemId: number): Promise<OmekaItem> {
  return fetchOmekaJson<OmekaItem>(`/items/${itemId}`);
}


export function itemToDocumentFields(item: OmekaItem) {
  const title =
    getFirstValue(item["dcterms:title"]) ||
    item["o:title"] ||
    `Item ${item["o:id"]}`;

  return {
    itemId: item["o:id"],
    title,
    description: getFirstValue(item["dcterms:description"]),
    documentType: getFirstValue(item["dcterms:type"]),
    date: getFirstValue(item["dcterms:date"]),
    creator: getFirstValue(item["dcterms:creator"]),
    identifier: getFirstValue(item["dcterms:identifier"]),
    isPartOf: getFirstValue(item["dcterms:isPartOf"]),
    subjects: getValueStrings(item["dcterms:subject"]),
    thumbnailUrl:
      item.thumbnail_display_urls?.large ||
      item.thumbnail_display_urls?.medium ||
      item.thumbnail_display_urls?.square ||
      null,
    edisonDigitalUrl: getItemPublicUrl(item["o:id"]),
    transcriptionPreview: getFirstValue(item["scripto:transcription"]).slice(0, 500),
  };
}
