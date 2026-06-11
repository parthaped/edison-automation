import { describe, expect, it } from "vitest";
import { buildSearchUrl, parseSearchPageParams } from "./search-params";

describe("search-params", () => {
  it("builds a search URL with all supported filters", () => {
    const url = buildSearchUrl({
      query: "electric light",
      page: 2,
      documentType: "Letter",
      collection: "Notebook",
      yearFrom: 1880,
      yearTo: 1889,
      decade: 1880,
      author: "Edison",
      recipient: "Johnson",
      subject: "Lighting",
      place: "Menlo Park",
      identifier: "E2002-001",
    });

    expect(url).toBe(
      "/search?q=electric+light&page=2&type=Letter&collection=Notebook&yearFrom=1880&yearTo=1889&decade=1880&author=Edison&recipient=Johnson&subject=Lighting&place=Menlo+Park&identifier=E2002-001",
    );
  });

  it("returns /search when no params are provided", () => {
    expect(buildSearchUrl({})).toBe("/search");
  });

  it("parses search page params with defaults and trimming", () => {
    const parsed = parseSearchPageParams({
      q: "  ore  ",
      page: "2",
      type: " Letter ",
      author: " Edison ",
      yearFrom: "1880",
      yearTo: "not-a-number",
    });

    expect(parsed).toEqual({
      query: "ore",
      page: 2,
      documentType: "Letter",
      collection: undefined,
      yearFrom: 1880,
      yearTo: undefined,
      decade: undefined,
      author: "Edison",
      recipient: undefined,
      subject: undefined,
      place: undefined,
      identifier: undefined,
    });
  });

  it("defaults page to 1 when missing or invalid", () => {
    expect(parseSearchPageParams({}).page).toBe(1);
    expect(parseSearchPageParams({ page: "abc" }).page).toBe(1);
  });
});
