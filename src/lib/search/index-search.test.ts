import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SearchIndexRecord } from "./index-types";
import { createMiniSearchFromRecords, searchIndex } from "./index-search";
import {
  applyStructuredFilters,
  countFacets,
  hasSearchCriteria,
  parseSearchFilterParams,
} from "./search-filters";

function loadFixtureRecords(): SearchIndexRecord[] {
  const fixturePath = join(__dirname, "__fixtures__", "search-index-v1.jsonl");
  return readFileSync(fixturePath, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as SearchIndexRecord);
}

describe("search-filters", () => {
  const records = loadFixtureRecords();

  it("detects active search criteria", () => {
    expect(hasSearchCriteria(parseSearchFilterParams({ q: "ore" }))).toBe(true);
    expect(hasSearchCriteria(parseSearchFilterParams({ type: "Letter" }))).toBe(true);
    expect(hasSearchCriteria(parseSearchFilterParams({}))).toBe(false);
  });

  it("filters by year range and document type", () => {
    const filtered = applyStructuredFilters(records, {
      yearFrom: 1880,
      yearTo: 1882,
      documentType: "Letter",
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.identifier).toBe("E2002-001");
  });

  it("filters by place and author", () => {
    const filtered = applyStructuredFilters(records, {
      place: "Menlo Park",
      author: "Edison",
    });
    expect(filtered).toHaveLength(2);
  });

  it("builds facet counts from filtered records", () => {
    const facets = countFacets(records);
    expect(facets.documentTypes.some((entry) => entry.value === "Letter")).toBe(true);
    expect(facets.places.some((entry) => entry.value.includes("Menlo Park"))).toBe(true);
  });
});

describe("index-search", () => {
  const records = loadFixtureRecords();
  const miniSearch = createMiniSearchFromRecords(records);
  const manifest = {
    version: "v1",
    builtAt: "2026-01-01T00:00:00.000Z",
    recordCount: records.length,
    facets: countFacets(records),
  };

  it("finds contextually related ore crushing language", () => {
    const started = performance.now();
    const output = searchIndex({
      miniSearch,
      allRecords: records,
      manifest,
      filters: { query: "crushing ore" },
      page: 1,
      perPage: 10,
    });
    const elapsed = performance.now() - started;

    expect(output.totalResults).toBeGreaterThan(0);
    expect(output.results[0]?.identifier).toBe("E2002-001");
    expect(output.expandedTerms.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });

  it("combines keywords with time period filters", () => {
    const output = searchIndex({
      miniSearch,
      allRecords: records,
      manifest,
      filters: {
        query: "electric",
        yearFrom: 1880,
        yearTo: 1880,
      },
      page: 1,
      perPage: 10,
    });

    expect(output.totalResults).toBe(1);
    expect(output.results[0]?.identifier).toBe("E2002-002");
  });

  it("supports browse-only filter mode without keywords", () => {
    const output = searchIndex({
      miniSearch,
      allRecords: records,
      manifest,
      filters: { documentType: "Letter" },
      page: 1,
      perPage: 10,
    });

    expect(output.totalResults).toBe(2);
    expect(output.searchMode).toBe("browse");
  });
});
