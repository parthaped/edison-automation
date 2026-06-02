import { describe, expect, it } from "vitest";
import { mergePageChunkResults } from "./page-chunk-transcribe";

describe("mergePageChunkResults", () => {
  const metadata = {
    title: "Sample",
    documentType: "correspondence",
    date: "1890",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
    places: [],
  };

  it("orders pages and produces one sub-document by default", () => {
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
      metadata,
    );

    expect(merged.subDocuments).toHaveLength(1);
    expect(merged.subDocuments[0].startPage).toBe(1);
    expect(merged.subDocuments[0].endPage).toBe(3);
    expect(merged.ocrText).toBe("Page one\n\nPage two\n\nPage three");
    expect(merged.model).toBe("test-model");
  });

  it("splits merged page text with chunked sub-document plans", () => {
    const merged = mergePageChunkResults(
      [
        {
          pages: [
            { pageNumber: 1, text: "First letter page one" },
            { pageNumber: 2, text: "First letter page two" },
          ],
          model: "test-model",
          promptVersion: "v1",
        },
        {
          pages: [
            { pageNumber: 3, text: "Second letter page one" },
            { pageNumber: 4, text: "Second letter page two [unclear?]" },
          ],
          model: "test-model",
          promptVersion: "v1",
        },
      ],
      4,
      metadata,
      [
        {
          startPage: 1,
          endPage: 2,
          metadata: { ...metadata, title: "First" },
        },
        {
          startPage: 3,
          endPage: 4,
          metadata: { ...metadata, title: "Second" },
        },
      ],
    );

    expect(merged.subDocuments).toHaveLength(2);
    expect(merged.subDocuments[0]).toMatchObject({
      startPage: 1,
      endPage: 2,
      ocrText: "First letter page one\n\nFirst letter page two",
      metadata: { title: "First" },
    });
    expect(merged.subDocuments[1]).toMatchObject({
      startPage: 3,
      endPage: 4,
      metadata: { title: "Second" },
    });
    expect(merged.subDocuments[1].uncertainReadings).toEqual(["[unclear?]"]);
  });

  it("normalizes chunked split plans so every page is covered", () => {
    const merged = mergePageChunkResults(
      [
        {
          pages: [
            { pageNumber: 1, text: "p1" },
            { pageNumber: 2, text: "p2" },
            { pageNumber: 3, text: "p3" },
            { pageNumber: 4, text: "p4" },
          ],
          model: "test-model",
          promptVersion: "v1",
        },
      ],
      4,
      metadata,
      [
        {
          startPage: 2,
          endPage: 2,
          metadata: { ...metadata, title: "First" },
        },
        {
          startPage: 2,
          endPage: 3,
          metadata: { ...metadata, title: "Second" },
        },
      ],
    );

    expect(
      merged.subDocuments.map((sub) => [sub.startPage, sub.endPage]),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(merged.subDocuments[0].ocrText).toBe("p1\n\np2");
    expect(merged.subDocuments[1].ocrText).toBe("p3\n\np4");
  });
});
