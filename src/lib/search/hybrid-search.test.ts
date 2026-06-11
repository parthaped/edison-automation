import { describe, expect, it } from "vitest";
import type { SearchResultDocument } from "@/lib/omeka/types";
import { mergeWithReciprocalRankFusion } from "./hybrid-search";

function doc(itemId: number, score = 1): SearchResultDocument {
  return {
    itemId,
    title: `Item ${itemId}`,
    description: "",
    documentType: "",
    date: "",
    creator: "",
    identifier: "",
    isPartOf: "",
    subjects: [],
    thumbnailUrl: null,
    edisonDigitalUrl: "",
    snippet: `snippet-${itemId}`,
    relevanceScore: score,
    matchedTerms: [],
    transcriptionPreview: "",
  };
}

describe("mergeWithReciprocalRankFusion", () => {
  it("ranks items present in both lists higher than single-list items", () => {
    const keyword = [doc(1, 0.9), doc(2, 0.8), doc(3, 0.7)];
    const vector = [doc(2, 0.95), doc(4, 0.85)];

    const merged = mergeWithReciprocalRankFusion(keyword, vector);

    expect(merged[0]?.itemId).toBe(2);
    expect(merged.map((entry) => entry.itemId)).toEqual([2, 1, 4, 3]);
  });

  it("preserves keyword snippet when both lists include the same item", () => {
    const keyword = [{ ...doc(10, 0.5), snippet: "keyword snippet" }];
    const vector = [{ ...doc(10, 0.9), snippet: "vector snippet" }];

    const merged = mergeWithReciprocalRankFusion(keyword, vector);

    expect(merged[0]?.snippet).toBe("keyword snippet");
    expect(merged[0]?.relevanceScore).toBe(0.9);
  });

  it("includes vector-only hits", () => {
    const merged = mergeWithReciprocalRankFusion([], [doc(42, 0.77)]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.itemId).toBe(42);
  });
});
