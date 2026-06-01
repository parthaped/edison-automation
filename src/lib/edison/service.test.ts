import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { InMemoryEdisonRepository } from "./in-memory-repository";
import {
  EdisonAutomationService,
  mergeTranscribedMetadata,
  processSourceFile,
  resolvePersistedDocumentStatus,
} from "./service";
import type { DocumentPackage, MetadataExtraction } from "./types";

async function makeUploadFile(name: string, type: string): Promise<File> {
  return makeMultiPageUploadFile(name, type, 1);
}

async function makeMultiPageUploadFile(
  name: string,
  type: string,
  pageCount: number,
): Promise<File> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) {
    pdf.addPage([200, 200]);
  }
  const bytes = await pdf.save();
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([arrayBuffer], name, { type });
}

describe("EdisonAutomationService", () => {
  it("builds review workbench data through the repository boundary", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(true));

    const { summary, reviewCase } = await service.getReviewWorkbench();

    expect(summary.total).toBeGreaterThan(0);
    expect(reviewCase?.documents.length).toBeGreaterThan(0);
  });

  it("processes a source file and persists it through the repository", async () => {
    const repository = new InMemoryEdisonRepository(false);
    const file = await makeUploadFile("D9032-00001.pdf", "application/pdf");
    const bytes = new Uint8Array(await file.arrayBuffer());

    const processed = await processSourceFile({
      sourceFile: {
        id: "src-1",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "D9032-F",
      batchIndex: 1,
      existingIds: new Set(),
    });

    expect(processed.documentPackage.documentId).toBe("D9032-00001");

    await repository.saveProcessedDocument(
      processed.documentPackage,
      processed.transcription,
      processed.metadata,
    );
    expect(await repository.listDocuments()).toHaveLength(1);
  });

  it("preserves a pre-assigned document identifier", async () => {
    const file = await makeUploadFile("scan-front.pdf", "application/pdf");
    const bytes = new Uint8Array(await file.arrayBuffer());

    const processed = await processSourceFile({
      sourceFile: {
        id: "src-2",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "D9032-F",
      batchIndex: 2,
      existingIds: new Set(),
      providedDocumentId: "D9032-00002-1",
    });

    expect(processed.documentPackage.documentId).toBe("D9032-00002-1");
  });

  it("attaches per-page image URLs supplied by the rasterize step", async () => {
    const file = await makeMultiPageUploadFile(
      "two-page.pdf",
      "application/pdf",
      2,
    );
    const bytes = new Uint8Array(await file.arrayBuffer());

    const processed = await processSourceFile({
      sourceFile: {
        id: "src-3",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "D9032-F",
      batchIndex: 3,
      existingIds: new Set(),
      pageImageUrls: [
        { pageIndex: 0, url: "https://blob.example/page-1.jpg", width: 800, height: 1100 },
        { pageIndex: 1, url: "https://blob.example/page-2.jpg" },
      ],
    });

    expect(processed.documentPackage.pages).toHaveLength(2);
    expect(processed.documentPackage.pages[0].originalUrl).toBe(
      "https://blob.example/page-1.jpg",
    );
    expect(processed.documentPackage.pages[0].width).toBe(800);
    expect(processed.documentPackage.pages[0].height).toBe(1100);
    expect(processed.documentPackage.pages[1].originalUrl).toBe(
      "https://blob.example/page-2.jpg",
    );
  });

  it("attaches a single image URL to page 0 for image uploads", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const processed = await processSourceFile({
      sourceFile: {
        id: "src-4",
        name: "scan.jpg",
        size: bytes.byteLength,
        mimeType: "image/jpeg",
      },
      bytes,
      folderId: "D9032-F",
      batchIndex: 4,
      existingIds: new Set(),
      pageImageUrls: [
        { pageIndex: 0, url: "https://blob.example/scan.jpg" },
      ],
    });

    expect(processed.documentPackage.pages[0]?.originalUrl).toBe(
      "https://blob.example/scan.jpg",
    );
  });

  it("refuses to export when no documents are approved", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(true));

    await expect(service.exportOmekaCsv()).rejects.toMatchObject({
      code: "EXPORT_FAILED",
      status: 409,
    });
  });

  it("exports only approved records to the Omeka CSV", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);
    const documents = await repository.listDocuments();
    const target = documents.find((document) => document.documentId === "D9032-00001");
    if (!target) {
      throw new Error("Seed data must include D9032-00001 for this test.");
    }
    await repository.saveDocuments([{ ...target, status: "approved" }]);

    const csv = await service.exportOmekaCsv();

    expect(csv).toContain("Folder ID,Doc ID");
    expect(csv).toContain("D9032-F");
  });
});

describe("processSourceFile confidence", () => {
  it("syncs scored confidence onto documentPackage and metadata", async () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(0),
    ]);
    const rawOcrText = "[a?] [b?] [c?] [d?] [e?] [f?] [g?]";

    const result = await processSourceFile({
      sourceFile: {
        id: "src-conf",
        name: "letter.png",
        size: bytes.byteLength,
        mimeType: "image/png",
      },
      bytes,
      folderId: "D9032-F",
      batchIndex: 1,
      existingIds: new Set(),
      rawOcrText,
    });

    expect(result.documentPackage.confidence).toBe("low");
    expect(result.metadata.confidence).toBe("low");
    expect(result.confidence).toBe("low");
  });

  it("marks blocked packages with blocked confidence on document and metadata", async () => {
    const result = await processSourceFile({
      sourceFile: {
        id: "src-blocked",
        name: "scan.bin",
        size: 32,
        mimeType: "application/octet-stream",
      },
      bytes: new Uint8Array(32),
      batchIndex: 1,
      existingIds: new Set(),
    });

    expect(result.documentPackage.status).toBe("blocked");
    expect(result.documentPackage.confidence).toBe("blocked");
    expect(result.metadata.confidence).toBe("blocked");
  });

  it("deduplicates uncertain readings in transcription output", async () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(56).fill(0),
    ]);
    const result = await processSourceFile({
      sourceFile: {
        id: "src-dedupe",
        name: "letter.png",
        size: bytes.byteLength,
        mimeType: "image/png",
      },
      bytes,
      batchIndex: 1,
      existingIds: new Set(),
      rawOcrText:
        "Edison Electric Light Co. reports on the [filament?] tests and [filament?] again.",
    });

    expect(result.transcription.uncertainReadings).toEqual(["[filament?]"]);
  });

  it("uses the last pageImageUrl when duplicate pageIndex entries are supplied", async () => {
    const file = await makeUploadFile("dup-pages.pdf", "application/pdf");
    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await processSourceFile({
      sourceFile: {
        id: "src-dup-url",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      batchIndex: 1,
      existingIds: new Set(),
      pageImageUrls: [
        { pageIndex: 0, url: "https://blob.example/first.jpg" },
        { pageIndex: 0, url: "https://blob.example/last.jpg" },
      ],
    });

    expect(result.documentPackage.pages[0]?.originalUrl).toBe(
      "https://blob.example/last.jpg",
    );
  });
});

describe("resolvePersistedDocumentStatus", () => {
  const basePackage = (overrides: Partial<DocumentPackage>): DocumentPackage => ({
    id: "DOC-1",
    folderId: "F-1",
    documentId: "DOC-1",
    title: "Test",
    sourceFile: {
      id: "sf-1",
      name: "test.pdf",
      size: 100,
      mimeType: "application/pdf",
    },
    pages: [
      {
        id: "DOC-1-page-1",
        documentId: "DOC-1",
        pageIndex: 0,
        imageFilename: "DOC-1/test_0001.jpg",
        sourcePage: 1,
      },
    ],
    status: "queued",
    confidence: "medium",
    validationWarnings: [],
    uncertaintyNotes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  });

  it("promotes queued packages with pages to needs_review", () => {
    const result = resolvePersistedDocumentStatus(basePackage({}));
    expect(result.status).toBe("needs_review");
  });

  it("leaves blocked packages with no pages unchanged", () => {
    const result = resolvePersistedDocumentStatus(
      basePackage({ status: "blocked", pages: [], confidence: "blocked" }),
    );
    expect(result.status).toBe("blocked");
  });

  it("leaves already needs_review packages unchanged", () => {
    const result = resolvePersistedDocumentStatus(
      basePackage({ status: "needs_review" }),
    );
    expect(result.status).toBe("needs_review");
  });
});

describe("mergeTranscribedMetadata", () => {
  const processed: MetadataExtraction = {
    folderId: "D9032-F",
    documentId: "D9032-00001",
    documentType: "Unknown",
    date: "Unknown",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: ["Needs review"],
    imageNames: ["page.jpg"],
    confidence: "medium",
  };

  it("preserves default subjects when AI returns an empty subjects array", () => {
    const merged = mergeTranscribedMetadata(processed, {
      documentType: "letter",
      date: "1890",
      authors: ["Edison"],
      recipients: [],
      mentionedNames: [],
      subjects: [],
    });

    expect(merged.subjects).toEqual(["Needs review"]);
    expect(merged.documentType).toBe("letter");
  });

  it("uses AI subjects when the model returned at least one", () => {
    const merged = mergeTranscribedMetadata(processed, {
      documentType: "letter",
      date: "1890",
      authors: [],
      recipients: [],
      mentionedNames: [],
      subjects: ["Electric light"],
    });

    expect(merged.subjects).toEqual(["Electric light"]);
  });
});
