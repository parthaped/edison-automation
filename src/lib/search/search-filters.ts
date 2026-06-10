import type { SearchFilterParams, SearchIndexRecord } from "./index-types";

function matchesContains(field: string, needle: string): boolean {
  if (!needle) return true;
  return field.toLowerCase().includes(needle);
}

function matchesArrayContains(values: string[], needle: string): boolean {
  if (!needle) return true;
  const normalized = needle.toLowerCase();
  return values.some((value) => value.toLowerCase().includes(normalized));
}

function matchesExactOrContains(field: string, filter: string | undefined): boolean {
  if (!filter) return true;
  const normalizedField = field.toLowerCase();
  const normalizedFilter = filter.toLowerCase();
  return (
    normalizedField === normalizedFilter ||
    normalizedField.includes(normalizedFilter)
  );
}

export function applyStructuredFilters(
  records: SearchIndexRecord[],
  filters: SearchFilterParams,
): SearchIndexRecord[] {
  const yearFrom = filters.yearFrom;
  const yearTo = filters.yearTo;
  const decade = filters.decade;

  return records.filter((record) => {
    if (filters.documentType) {
      if (
        !matchesExactOrContains(record.documentType, filters.documentType)
      ) {
        return false;
      }
    }

    if (filters.collection) {
      if (!matchesContains(record.isPartOf, filters.collection)) {
        return false;
      }
    }

    if (filters.author) {
      if (!matchesArrayContains(record.creators, filters.author)) {
        return false;
      }
    }

    if (filters.recipient) {
      if (!matchesArrayContains(record.recipients, filters.recipient)) {
        return false;
      }
    }

    if (filters.subject) {
      if (!matchesArrayContains(record.subjects, filters.subject)) {
        return false;
      }
    }

    if (filters.place) {
      if (!matchesArrayContains(record.places, filters.place)) {
        return false;
      }
    }

    if (filters.identifier) {
      if (!matchesContains(record.identifier, filters.identifier)) {
        return false;
      }
    }

    if (decade !== undefined) {
      if (record.dateDecade !== decade) {
        return false;
      }
    }

    if (yearFrom !== undefined || yearTo !== undefined) {
      if (record.dateYear === null) {
        return false;
      }
      if (yearFrom !== undefined && record.dateYear < yearFrom) {
        return false;
      }
      if (yearTo !== undefined && record.dateYear > yearTo) {
        return false;
      }
    }

    return true;
  });
}

export function parseSearchFilterParams(input: {
  q?: string;
  yearFrom?: string | number;
  yearTo?: string | number;
  decade?: string | number;
  type?: string;
  collection?: string;
  author?: string;
  recipient?: string;
  subject?: string;
  place?: string;
  identifier?: string;
}): SearchFilterParams {
  const parseOptionalInt = (value: string | number | undefined): number | undefined => {
    if (value === undefined || value === "") return undefined;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return {
    query: input.q?.trim() || undefined,
    yearFrom: parseOptionalInt(input.yearFrom),
    yearTo: parseOptionalInt(input.yearTo),
    decade: parseOptionalInt(input.decade),
    documentType: input.type?.trim() || undefined,
    collection: input.collection?.trim() || undefined,
    author: input.author?.trim() || undefined,
    recipient: input.recipient?.trim() || undefined,
    subject: input.subject?.trim() || undefined,
    place: input.place?.trim() || undefined,
    identifier: input.identifier?.trim() || undefined,
  };
}

export function hasActiveFilters(filters: SearchFilterParams): boolean {
  return Boolean(
    filters.yearFrom !== undefined ||
      filters.yearTo !== undefined ||
      filters.decade !== undefined ||
      filters.documentType ||
      filters.collection ||
      filters.author ||
      filters.recipient ||
      filters.subject ||
      filters.place ||
      filters.identifier,
  );
}

export function countFacets(records: SearchIndexRecord[]) {
  const documentTypes = new Map<string, number>();
  const collections = new Map<string, number>();
  const decades = new Map<string, number>();
  const subjects = new Map<string, number>();
  const places = new Map<string, number>();
  const creators = new Map<string, number>();

  for (const record of records) {
    if (record.documentType) {
      documentTypes.set(
        record.documentType,
        (documentTypes.get(record.documentType) ?? 0) + 1,
      );
    }
    if (record.isPartOf) {
      collections.set(
        record.isPartOf,
        (collections.get(record.isPartOf) ?? 0) + 1,
      );
    }
    if (record.dateDecade !== null) {
      const key = String(record.dateDecade);
      decades.set(key, (decades.get(key) ?? 0) + 1);
    }
    for (const subject of record.subjects) {
      subjects.set(subject, (subjects.get(subject) ?? 0) + 1);
    }
    for (const place of record.places) {
      places.set(place, (places.get(place) ?? 0) + 1);
    }
    for (const creator of record.creators) {
      creators.set(creator, (creators.get(creator) ?? 0) + 1);
    }
  }

  const toSorted = (map: Map<string, number>, limit = 12) =>
    [...map.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, limit);

  return {
    documentTypes: toSorted(documentTypes),
    collections: toSorted(collections),
    decades: toSorted(decades),
    subjects: toSorted(subjects, 20),
    places: toSorted(places, 20),
    creators: toSorted(creators, 20),
  };
}

export function hasSearchCriteria(filters: SearchFilterParams): boolean {
  return Boolean(filters.query || hasActiveFilters(filters));
}
