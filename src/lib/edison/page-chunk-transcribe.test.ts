import { describe, expect, it } from "vitest";
import { mergePageChunkResults } from "./page-chunk-transcribe";

describe("mergePageChunkResults", () => {
  it("orders pages and produces one sub-document", () => {
    const merged = mergePageChunkResults(
      [
        {
          pages: [
            { pageNumber: 2, text: "Page two" },
            { pageNumber: 1, text: "Page one" },
          ],
          model: "test-model",
          promptVersion: "v1",
        },
        {
          pages: [{ pageNumber: 3, text: "Page three" }],
          model: "test-model",
          promptVersion: "v1",
        },
      ],
      3,
      {
        title: "Sample",
        documentType: "correspondence",
        date: "1890",
        authors: [],
        recipients: [],
        mentionedNames: [],
        subjects: [],
      },
    );

    expect(merged.subDocuments).toHaveLength(1);
    expect(merged.subDocuments[0].startPage).toBe(1);
    expect(merged.subDocuments[0].endPage).toBe(3);
    expect(merged.ocrText).toBe("Page one\n\nPage two\n\nPage three");
    expect(merged.model).toBe("test-model");
  });
});
