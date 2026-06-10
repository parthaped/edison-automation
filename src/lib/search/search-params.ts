import type { SearchFilterParams } from "@/lib/search/index-types";

export interface SearchPageParams extends SearchFilterParams {
  page?: number;
}

export function buildSearchUrl(params: SearchPageParams): string {
  const searchParams = new URLSearchParams();

  if (params.query) {
    searchParams.set("q", params.query);
  }
  if (params.page && params.page > 1) {
    searchParams.set("page", String(params.page));
  }
  if (params.documentType) {
    searchParams.set("type", params.documentType);
  }
  if (params.collection) {
    searchParams.set("collection", params.collection);
  }
  if (params.yearFrom !== undefined) {
    searchParams.set("yearFrom", String(params.yearFrom));
  }
  if (params.yearTo !== undefined) {
    searchParams.set("yearTo", String(params.yearTo));
  }
  if (params.decade !== undefined) {
    searchParams.set("decade", String(params.decade));
  }
  if (params.author) {
    searchParams.set("author", params.author);
  }
  if (params.recipient) {
    searchParams.set("recipient", params.recipient);
  }
  if (params.subject) {
    searchParams.set("subject", params.subject);
  }
  if (params.place) {
    searchParams.set("place", params.place);
  }
  if (params.identifier) {
    searchParams.set("identifier", params.identifier);
  }

  const query = searchParams.toString();
  return query ? `/search?${query}` : "/search";
}

export function parseSearchPageParams(input: Record<string, string | undefined>): SearchPageParams {
  const parseIntParam = (value: string | undefined): number | undefined => {
    if (!value) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    query: input.q?.trim() || undefined,
    page: parseIntParam(input.page) ?? 1,
    documentType: input.type?.trim() || undefined,
    collection: input.collection?.trim() || undefined,
    yearFrom: parseIntParam(input.yearFrom),
    yearTo: parseIntParam(input.yearTo),
    decade: parseIntParam(input.decade),
    author: input.author?.trim() || undefined,
    recipient: input.recipient?.trim() || undefined,
    subject: input.subject?.trim() || undefined,
    place: input.place?.trim() || undefined,
    identifier: input.identifier?.trim() || undefined,
  };
}
