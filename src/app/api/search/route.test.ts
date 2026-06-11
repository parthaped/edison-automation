import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { OmekaSearchError } from "@/lib/search/omeka-live-search";

const semanticSearchMock = vi.fn();

vi.mock("@/lib/search/semantic-search", () => ({
  semanticSearch: (...args: unknown[]) => semanticSearchMock(...args),
}));

describe("GET /api/search", () => {
  it("returns 400 for invalid search parameters", async () => {
    const response = await GET(
      new Request("https://example.test/api/search?page=0&q=ore"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid search parameters." });
  });

  it("returns 400 when no query or filters are provided", async () => {
    const response = await GET(new Request("https://example.test/api/search"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Provide keywords or at least one filter.",
    });
  });

  it("returns 502 when Omeka search fails", async () => {
    semanticSearchMock.mockRejectedValue(
      new OmekaSearchError("Omeka unavailable"),
    );

    const response = await GET(
      new Request("https://example.test/api/search?q=electric+light"),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Omeka unavailable" });
  });

  it("returns search results on success", async () => {
    semanticSearchMock.mockResolvedValue({
      query: "electric light",
      expandedTerms: [],
      totalResults: 1,
      page: 1,
      perPage: 20,
      results: [{ itemId: 42, title: "Electric lamp tests" }],
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
    });

    const response = await GET(
      new Request("https://example.test/api/search?q=electric+light&author=Edison"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      totalResults: 1,
      results: [{ itemId: 42 }],
    });
    expect(semanticSearchMock).toHaveBeenCalledWith({
      query: "electric light",
      page: undefined,
      perPage: undefined,
      documentType: undefined,
      collection: undefined,
      yearFrom: undefined,
      yearTo: undefined,
      decade: undefined,
      author: "Edison",
      recipient: undefined,
      subject: undefined,
      place: undefined,
      identifier: undefined,
    });
  });
});
