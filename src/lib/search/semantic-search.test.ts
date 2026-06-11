import { describe, expect, it, vi, beforeEach } from "vitest";
import { semanticSearch } from "./semantic-search";

const searchOmekaLiveMock = vi.fn();
const hybridSearchMock = vi.fn();
const isSemanticSearchConfiguredMock = vi.fn();
const isSemanticSearchAvailableMock = vi.fn();

vi.mock("./omeka-live-search", () => ({
  searchOmekaLive: (...args: unknown[]) => searchOmekaLiveMock(...args),
}));

vi.mock("./hybrid-search", () => ({
  hybridSearch: (...args: unknown[]) => hybridSearchMock(...args),
}));

vi.mock("./vector-search-client", () => ({
  isSemanticSearchConfigured: () => isSemanticSearchConfiguredMock(),
  isSemanticSearchAvailable: () => isSemanticSearchAvailableMock(),
}));

describe("semanticSearch", () => {
  beforeEach(() => {
    searchOmekaLiveMock.mockReset();
    hybridSearchMock.mockReset();
    isSemanticSearchConfiguredMock.mockReset();
    isSemanticSearchAvailableMock.mockReset();
    isSemanticSearchConfiguredMock.mockReturnValue(false);
    isSemanticSearchAvailableMock.mockResolvedValue(false);
  });

  it("returns an empty payload when no search criteria are present", async () => {
    const result = await semanticSearch({});

    expect(result).toMatchObject({
      query: "",
      totalResults: 0,
      results: [],
      searchMode: "keyword",
      indexBuiltAt: null,
    });
    expect(searchOmekaLiveMock).not.toHaveBeenCalled();
    expect(hybridSearchMock).not.toHaveBeenCalled();
  });

  it("clamps page and perPage before delegating", async () => {
    searchOmekaLiveMock.mockResolvedValue({
      query: "electric light",
      expandedTerms: [],
      totalResults: 1,
      page: 1,
      perPage: 50,
      results: [],
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

    await semanticSearch({
      query: "electric light",
      page: 0,
      perPage: 100,
    });

    expect(searchOmekaLiveMock).toHaveBeenCalledWith({
      query: "electric light",
      page: 1,
      perPage: 50,
    });
  });

  it("delegates to searchOmekaLive when filters are present", async () => {
    searchOmekaLiveMock.mockResolvedValue({
      query: "",
      expandedTerms: [],
      totalResults: 2,
      page: 2,
      perPage: 10,
      results: [],
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

    const result = await semanticSearch({
      author: "Edison",
      page: 2,
      perPage: 10,
    });

    expect(searchOmekaLiveMock).toHaveBeenCalledWith({
      author: "Edison",
      page: 2,
      perPage: 10,
    });
    expect(result.totalResults).toBe(2);
  });

  it("uses hybrid search when the local sidecar is configured and healthy", async () => {
    isSemanticSearchConfiguredMock.mockReturnValue(true);
    isSemanticSearchAvailableMock.mockResolvedValue(true);
    hybridSearchMock.mockResolvedValue({
      query: "phonograph",
      expandedTerms: [],
      totalResults: 3,
      page: 1,
      perPage: 20,
      results: [],
      facets: {
        documentTypes: [],
        collections: [],
        decades: [],
        subjects: [],
        places: [],
        creators: [],
      },
      searchMode: "hybrid",
      indexBuiltAt: "2026-01-01T00:00:00Z",
      manifestFacets: null,
    });

    const result = await semanticSearch({ query: "phonograph" });

    expect(hybridSearchMock).toHaveBeenCalledWith({
      query: "phonograph",
      page: 1,
      perPage: 20,
    });
    expect(searchOmekaLiveMock).not.toHaveBeenCalled();
    expect(result.searchMode).toBe("hybrid");
  });
});
