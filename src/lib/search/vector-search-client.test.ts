import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isSemanticSearchAvailable,
  resetSemanticSearchHealthCache,
  searchVectorIndex,
} from "./vector-search-client";

describe("vector-search-client auth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    resetSemanticSearchHealthCache();
  });

  it("sends Authorization when SEMANTIC_SEARCH_SECRET is set", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_URL", "http://127.0.0.1:8765");
    vi.stubEnv("SEMANTIC_SEARCH_SECRET", "test-secret");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ results: [], indexBuiltAt: null }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await searchVectorIndex("phonograph", {});

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/search",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-secret",
        }),
      }),
    );
  });

  it("includes Authorization on health checks", async () => {
    vi.stubEnv("SEMANTIC_SEARCH_URL", "http://127.0.0.1:8765");
    vi.stubEnv("SEMANTIC_SEARCH_SECRET", "health-secret");

    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await isSemanticSearchAvailable();

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8765/health",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer health-secret",
        }),
      }),
    );
  });
});
