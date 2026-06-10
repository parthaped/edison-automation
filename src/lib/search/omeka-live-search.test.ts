import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildOmekaSearchParams, searchOmekaItemsPage } from "@/lib/omeka/client";
import { searchOmekaLive } from "./omeka-live-search";

describe("buildOmekaSearchParams", () => {
  it("includes fulltext_search for keyword queries", () => {
    const params = buildOmekaSearchParams("electric light", { page: 2, perPage: 20 });
    expect(params.fulltext_search).toBe("electric light");
    expect(params.page).toBe("2");
    expect(params.per_page).toBe("20");
  });

  it("maps advanced filters to Omeka property params", () => {
    const params = buildOmekaSearchParams("", {
      useFulltext: false,
      filters: {
        documentType: "Letter",
        author: "Edison",
        yearFrom: 1880,
        yearTo: 1889,
      },
    });

    expect(params.fulltext_search).toBeUndefined();
    expect(params["property[0][property]"]).toBe("dcterms:type");
    expect(params["property[0][text]"]).toBe("Letter");
    expect(params["property[1][property]"]).toBe("dcterms:creator");
    expect(params["property[1][text]"]).toBe("Edison");
    expect(params["property[2][property]"]).toBe("dcterms:date");
    expect(params["property[2][type]"]).toBe("gte");
    expect(params["property[2][text]"]).toBe("1880");
    expect(params["property[3][type]"]).toBe("lte");
    expect(params["property[3][text]"]).toBe("1889");
  });
});

describe("searchOmekaLive", () => {
  const sampleItem = {
    "o:id": 42,
    "o:title": "Electric lamp tests",
    "dcterms:title": [{ "@value": "Electric lamp tests" }],
    "dcterms:description": [{ "@value": "Carbon filament experiments." }],
    "dcterms:type": [{ "@value": "Notebook page" }],
    "dcterms:date": [{ "@value": "1880-11-02" }],
    "dcterms:creator": [{ "@value": "Edison, Thomas A." }],
    "dcterms:identifier": [{ "@value": "E2002-002" }],
    "dcterms:isPartOf": [{ "@value": "[E2002-F] Document File Series -- 1880" }],
    "dcterms:subject": [{ "@value": "Electric lighting" }],
    "scripto:transcription": [
      { "@value": "Continued tests on the incandescent lamp and electric light." },
    ],
    thumbnail_display_urls: { medium: "https://example.com/thumb.jpg" },
  };

  const crotonItem = {
    "o:id": 99,
    "o:title": "Letter from croton magnetic iron mines W H Hoffman to Thomas Alva Edison",
    "dcterms:title": [
      {
        "@value": "Letter from croton magnetic iron mines W H Hoffman to Thomas Alva Edison",
      },
    ],
    "dcterms:type": [{ "@value": "Letter" }],
    "dcterms:subject": [{ "@value": "Iron mines and mining" }],
    "scripto:transcription": [
      {
        "@value":
          "Dear Mr Edison, we are writing about ore shipments from the Croton magnetic iron mines.",
      },
    ],
  };

  const motionPictureItem = {
    "o:id": 100,
    "o:title": "Letter about kinetoscope demonstrations",
    "dcterms:title": [{ "@value": "Letter about kinetoscope demonstrations" }],
    "dcterms:type": [{ "@value": "Letter" }],
    "dcterms:subject": [{ "@value": "Motion pictures" }],
    "scripto:transcription": [
      {
        "@value":
          "We have been testing the kinetoscope and making motion pictures for upcoming exhibitions.",
      },
    ],
  };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).toContain("fulltext_search=electric+light");
        return new Response(JSON.stringify([sampleItem]), {
          status: 200,
          headers: { "Omeka-S-Total-Results": "1" },
        });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns mapped results for electric light", async () => {
    const response = await searchOmekaLive({ query: "electric light", page: 1, perPage: 10 });

    expect(response.totalResults).toBe(1);
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.identifier).toBe("E2002-002");
    expect(response.results[0]?.snippet.toLowerCase()).toContain("electric");
    expect(response.expandedTerms.length).toBeGreaterThan(0);
    expect(response.indexBuiltAt).toBeNull();
  });

  it("uses topic query and filters unrelated compound-query matches", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        expect(url).toContain("fulltext_search=making+motion+pictures");
        expect(url).toContain("property%5B0%5D%5Bproperty%5D=dcterms%3Atype");
        expect(url).toContain("property%5B0%5D%5Btext%5D=Letter");
        return new Response(JSON.stringify([crotonItem, motionPictureItem]), {
          status: 200,
          headers: { "Omeka-S-Total-Results": "2" },
        });
      }),
    );

    const response = await searchOmekaLive({
      query: "Letters about making motion pictures",
      page: 1,
      perPage: 10,
    });

    expect(response.searchMode).toBe("semantic");
    expect(response.results).toHaveLength(1);
    expect(response.results[0]?.itemId).toBe(100);
    expect(response.results[0]?.relevanceScore).toBeGreaterThanOrEqual(5);
  });
});

describe("searchOmekaItemsPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads Omeka-S-Total-Results for pagination", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Omeka-S-Total-Results": "33500" },
        });
      }),
    );

    const page = await searchOmekaItemsPage("electric light", { page: 2, perPage: 20 });

    expect(page.totalResults).toBe(33500);
    expect(page.page).toBe(2);
    expect(page.perPage).toBe(20);
  });
});
