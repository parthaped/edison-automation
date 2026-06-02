import { describe, expect, it } from "vitest";
import {
  isDeletableSourceBlob,
  isSourceBlobDeletionEnabled,
  shouldDeleteSourceAfterRasterize,
  shouldDeleteSourceAfterTranscribe,
} from "./source-blob-lifecycle";

const pdfBlob = {
  url: "https://example.com/manual-ingest/large.pdf",
  name: "large.pdf",
  size: 60 * 1024 * 1024,
  contentType: "application/pdf",
};

const smallPdfBlob = {
  ...pdfBlob,
  size: 2 * 1024 * 1024,
};

const imageBlob = {
  url: "https://example.com/manual-ingest/page.jpg",
  name: "page.jpg",
  size: 4 * 1024 * 1024,
  contentType: "image/jpeg",
};

const preparedWithPages = {
  urls: [{ pageIndex: 0, url: "https://example.com/page-images/1.jpg" }],
  extractionPlan: { kind: "pdf" as const, pageCount: 20, warnings: [] },
};

const preparedSmallWholeFile = {
  urls: [{ pageIndex: 0, url: "https://example.com/page-images/1.jpg" }],
  extractionPlan: { kind: "pdf" as const, pageCount: 5, warnings: [] },
};

const preparedFailed = {
  urls: [],
  extractionPlan: { kind: "pdf" as const, pageCount: 20, warnings: [] },
  error: "PDF rasterization failed",
};

describe("source blob lifecycle", () => {
  it("defaults deletion to enabled unless explicitly disabled", () => {
    expect(isSourceBlobDeletionEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(
      true,
    );
    expect(
      isSourceBlobDeletionEnabled({
        EDISON_DELETE_SOURCE_BLOB: "false",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe(false);
  });

  it("only treats PDF blobs as deletable sources", () => {
    expect(isDeletableSourceBlob(pdfBlob)).toBe(true);
    expect(isDeletableSourceBlob(imageBlob)).toBe(false);
  });

  it("deletes large chunked PDFs after rasterize when page JPGs exist", () => {
    expect(
      shouldDeleteSourceAfterRasterize({
        blob: pdfBlob,
        prepared: preparedWithPages,
      }),
    ).toBe(true);
  });

  it("does not delete images or failed rasterize results", () => {
    expect(
      shouldDeleteSourceAfterRasterize({
        blob: imageBlob,
        prepared: preparedWithPages,
      }),
    ).toBe(false);
    expect(
      shouldDeleteSourceAfterRasterize({
        blob: pdfBlob,
        prepared: preparedFailed,
      }),
    ).toBe(false);
  });

  it("deletes small whole-file PDFs after transcribe, not after rasterize", () => {
    const input = { blob: smallPdfBlob, prepared: preparedSmallWholeFile };
    expect(shouldDeleteSourceAfterRasterize(input)).toBe(false);
    expect(shouldDeleteSourceAfterTranscribe(input)).toBe(true);
  });

  it("respects opt-out env flag", () => {
    const env = { EDISON_DELETE_SOURCE_BLOB: "no" } as unknown as NodeJS.ProcessEnv;
    expect(
      shouldDeleteSourceAfterRasterize({
        blob: pdfBlob,
        prepared: preparedWithPages,
        env,
      }),
    ).toBe(false);
    expect(
      shouldDeleteSourceAfterTranscribe({
        blob: smallPdfBlob,
        prepared: preparedWithPages,
        env,
      }),
    ).toBe(false);
  });
});
