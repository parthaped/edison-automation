import { describe, expect, it } from "vitest";
import {
  mergeTranscribedMetadata,
  processSourceFile,
  resolvePersistedDocumentStatus,
  scoreConfidence,
} from "../service";
import type { SourceFile } from "../types";

describe("processSourceFile (workflow building block)", () => {
  it("marks blocked files when extraction fails", async () => {
    const sourceFile: SourceFile = {
      id: "src-1",
      name: "scan.bin",
      size: 32,
      mimeType: "application/octet-stream",
    };
    const result = await processSourceFile({
      sourceFile,
      bytes: new Uint8Array(32),
      batchIndex: 1,
      existingIds: new Set(),
    });
    expect(result.documentPackage.status).toBe("blocked");
    expect(result.confidence).toBe("blocked");
    expect(result.documentPackage.confidence).toBe("blocked");
  });

  it("produces a deterministic document id when an OCR text is available", async () => {
    const sourceFile: SourceFile = {
      id: "src-2",
      name: "letter.png",
      size: 64,
      mimeType: "image/png",
    };
    // Minimal PNG signature so file-validation accepts it as an image.
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(0),
    ]);
    const result = await processSourceFile({
      sourceFile,
      bytes,
      folderId: "E2002",
      batchIndex: 5,
      existingIds: new Set(),
      rawOcrText: "Edison Electric Light Co.",
    });
    expect(result.documentPackage.documentId).toMatch(/^E2002[A-Z]{3}/);
    expect(result.transcription.ocrText).toBe("Edison Electric Light Co.");
    expect(result.confidence).not.toBe("blocked");
  });
});

describe("scoreConfidence", () => {
  it("returns blocked when no pages were extracted", () => {
    const result = scoreConfidence({
      pageCount: 0,
      extractionErrors: 0,
      uncertainReadings: 0,
      wordCount: 0,
      ocrTextLength: 0,
    });
    expect(result.bucket).toBe("blocked");
  });

  it("penalizes a high density of uncertain readings", () => {
    const result = scoreConfidence({
      pageCount: 2,
      extractionErrors: 0,
      uncertainReadings: 5,
      wordCount: 80,
      ocrTextLength: 1000,
    });
    expect(result.bucket === "medium" || result.bucket === "low").toBe(true);
    expect(result.reasons.join(" ")).toMatch(/uncertain reading/);
  });

  it("returns high confidence for clean extractions", () => {
    const result = scoreConfidence({
      pageCount: 2,
      extractionErrors: 0,
      uncertainReadings: 0,
      wordCount: 400,
      ocrTextLength: 2000,
    });
    expect(result.bucket).toBe("high");
  });
});

describe("mergeTranscribedMetadata (persist step)", () => {
  it("leaves subjects empty when transcribed metadata has none", () => {
    const merged = mergeTranscribedMetadata(
      {
        folderId: "E2002",
        documentId: "E2002AAA",
        title: "[E2002AAA]",
        documentType: "",
        date: "",
        authors: [],
        recipients: [],
        mentionedNames: [],
        subjects: [],
        places: [],
        imageNames: [],
        confidence: "medium",
      },
      {
        title: "Marks to Edison",
        documentType: "correspondence",
        date: "1890",
        authors: [],
        recipients: [],
        mentionedNames: [],
        subjects: [],
        places: [],
      },
    );

    expect(merged.subjects).toEqual([]);
    expect(merged.title).toBe("Marks to Edison");
    expect(merged.documentType).toBe("Letter");
    expect(merged.date).toBe("1890");
  });
});

describe("resolvePersistedDocumentStatus (persist step)", () => {
  it("promotes extracted queued documents without requiring OCR text", async () => {
    const sourceFile: SourceFile = {
      id: "src-3",
      name: "letter.png",
      size: 64,
      mimeType: "image/png",
    };
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(0),
    ]);
    const processed = await processSourceFile({
      sourceFile,
      bytes,
      batchIndex: 1,
      existingIds: new Set(),
    });

    expect(processed.documentPackage.status).toBe("queued");

    const persisted = resolvePersistedDocumentStatus(processed.documentPackage);
    expect(persisted.status).toBe("needs_review");
  });
});
