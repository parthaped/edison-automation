import { describe, expect, it } from "vitest";
import { applyBatchEvent, initialSnapshot } from "./ingest-job-store";

describe("applyBatchEvent file timing", () => {
  it("stores stage timing on file-completed", () => {
    let snapshot = initialSnapshot("batch-1", {
      files: [{ name: "large.pdf", size: 500_000_000 }],
    });

    snapshot = applyBatchEvent(snapshot, {
      type: "file-completed",
      fileName: "large.pdf",
      documentId: "D9032-00001",
      at: "2026-06-01T12:00:00.000Z",
      stageTimingMs: {
        fetchMs: 1200,
        rasterizeMs: 8000,
        transcribeMs: 45000,
        persistMs: 300,
        totalMs: 54500,
        transcribeChunkCount: 12,
        rasterizeBackend: "pdfjs",
      },
    });

    expect(snapshot.perFile[0].stageTimingMs?.totalMs).toBe(54500);
    expect(snapshot.perFile[0].stageTimingMs?.transcribeChunkCount).toBe(12);
  });
});
