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

export async function fetchOmekaJson<T>(
  path: string,
  params?: Record<string, string>,
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
  });

  if (!response.ok) {
    throw new Error(`Omeka API error ${response.status} for ${url.pathname}`);
  }

  return (await response.json()) as T;
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
