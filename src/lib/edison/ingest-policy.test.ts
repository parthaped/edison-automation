import { describe, expect, it } from "vitest";
import {
  effectiveFileConcurrency,
  partitionPageRanges,
  shouldUsePageChunkedTranscription,
} from "./ingest-policy";

describe("shouldUsePageChunkedTranscription", () => {
  it("enables chunking for large PDFs by size", () => {
    expect(
      shouldUsePageChunkedTranscription({
        mimeType: "application/pdf",
        fileSizeBytes: 60 * 1024 * 1024,
        pageCount: 5,
      }),
    ).toBe(true);
  });

  it("enables chunking for many-page PDFs", () => {
    expect(
      shouldUsePageChunkedTranscription({
        mimeType: "application/pdf",
        fileSizeBytes: 1024,
        pageCount: 20,
      }),
    ).toBe(true);
  });

  it("skips chunking for small single-page images", () => {
    expect(
      shouldUsePageChunkedTranscription({
        mimeType: "image/png",
        fileSizeBytes: 1024 * 1024,
        pageCount: 1,
      }),
    ).toBe(false);
  });
});

describe("partitionPageRanges", () => {
  it("covers every page in contiguous ranges", () => {
    expect(partitionPageRanges(17, 8)).toEqual([
      { startPage: 1, endPage: 8 },
      { startPage: 9, endPage: 16 },
      { startPage: 17, endPage: 17 },
    ]);
  });
});

describe("effectiveFileConcurrency", () => {
  it("serializes very large files", () => {
    expect(
      effectiveFileConcurrency([{ size: 60 * 1024 * 1024 }], 3),
    ).toBe(1);
  });

  it("keeps base concurrency for small files", () => {
    expect(
      effectiveFileConcurrency([{ size: 1024 }, { size: 2048 }], 3),
    ).toBe(3);
  });
});
