import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "./audit-log";
import { InMemoryEdisonRepository } from "./in-memory-repository";
import {
  EdisonAutomationService,
  mergeTranscribedMetadata,
  normalizeSubDocuments,
  processSourceFile,
  processSourceFileSubDocuments,
  resolvePersistedDocumentStatus,
  validateContiguousSplits,
  type TranscribedSubDocument,
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
    const file = await makeUploadFile("E2002.pdf", "application/pdf");
    const bytes = new Uint8Array(await file.arrayBuffer());

    const processed = await processSourceFile({
      sourceFile: {
        id: "src-1",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "E2002",
      batchIndex: 1,
      existingIds: new Set(),
    });

    // Folder `E2002` + position 0 = TAEP-style `E2002AAA`.
    expect(processed.documentPackage.documentId).toBe("E2002AAA");

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
      folderId: "E2002",
      batchIndex: 2,
      existingIds: new Set(),
      providedDocumentId: "E2002AAF1",
    });

    expect(processed.documentPackage.documentId).toBe("E2002AAF1");
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
      folderId: "E2002",
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
      folderId: "E2002",
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

    await expect(service.exportTranscriptionsCsv()).rejects.toMatchObject({
      code: "EXPORT_FAILED",
      status: 409,
    });
  });

  it("exports only approved records to the transcriptions CSV", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);

    const approved = await service.approveDocument("E2002AAA");
    expect(approved.status).toBe("approved");

    const csv = await service.exportTranscriptionsCsv();

    expect(csv.split("\n")[0]).toBe(
      "o:id,dcterms:identifier,dcterms:title,dcterms:type,dcterms:date,dcterms:creator,bibo:recipient,dcterms:relation,dcterms:subject,dcterms:coverage,dcterms:isPartOf,scripto:transcription,o:media/file",
    );
    expect(csv).toContain("E2002AAA");
    expect(csv).toContain("[E2002-F] Document File Series -- 1890");
  });

  it("refuses to approve a blocked document", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);

    await expect(
      service.approveDocument("D8501AAA"),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", status: 409 });
  });

  it("throws NOT_FOUND when approving an unknown document", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(true));

    await expect(service.approveDocument("does-not-exist")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("deletes a document and removes it from review", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);

    await service.deleteDocument("E2002AAA");

    expect(await repository.getDocumentRecord("E2002AAA")).toBeNull();
    const { reviewCase } = await service.getReviewWorkbench();
    expect(
      reviewCase?.documents.some(
        (document) => document.documentId === "E2002AAA",
      ),
    ).toBe(false);
  });

  it("throws NOT_FOUND when deleting an unknown document", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(true));

    await expect(service.deleteDocument("does-not-exist")).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("unapproves a previously approved document", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);
    await service.approveDocument("E2002AAA");

    const restored = await service.unapproveDocument("E2002AAA");
    expect(restored.status).toBe("needs_review");
    const refetched = await repository.getDocumentRecord("E2002AAA");
    expect(refetched?.document.status).toBe("needs_review");
  });

  it("refuses to unapprove a document that is not approved", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);

    await expect(service.unapproveDocument("E2002AAA")).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 409,
    });
  });

  it("hides approved documents from the active review queue", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);

    await service.approveDocument("E2002AAA");
    const { reviewCase } = await service.getReviewWorkbench();
    expect(
      reviewCase?.documents.some((doc) => doc.documentId === "E2002AAA"),
    ).toBe(false);

    const past = await service.getApprovedDocuments({ offset: 0, limit: 50 });
    expect(past.documents.map((doc) => doc.documentId)).toContain("E2002AAA");
  });

  it("renames a standalone document's folder and migrates the record", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);

    const renamed = await service.renameFolderId("E2002AAA", "X9000");

    expect(renamed[0].document.folderId).toBe("X9000");
    expect(renamed[0].document.documentId).toBe("X9000AAA");
    expect(await repository.getDocumentRecord("E2002AAA")).toBeNull();
    expect(await repository.getDocumentRecord("X9000AAA")).not.toBeNull();
  });

  it("renames every sibling when the document belongs to a source group", async () => {
    const repository = new InMemoryEdisonRepository(false);
    const file = await makeMultiPageUploadFile(
      "group-rename.pdf",
      "application/pdf",
      4,
    );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const initial = await processSourceFileSubDocuments({
      sourceFile: {
        id: "src-rename",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "E2002",
      batchIndex: 1,
      existingIds: new Set(),
      providedDocumentId: "E2002AAA",
      subDocuments: [
        {
          startPage: 1,
          endPage: 2,
          ocrText: "A",
          uncertainReadings: [],
          metadata: {
            title: "First",
            documentType: "correspondence",
            date: "1890",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
        {
          startPage: 3,
          endPage: 4,
          ocrText: "B",
          uncertainReadings: [],
          metadata: {
            title: "Second",
            documentType: "correspondence",
            date: "1891",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
      ],
    });
    for (const sibling of initial.siblings) {
      await repository.saveProcessedDocument(
        sibling.documentPackage,
        sibling.transcription,
        sibling.metadata,
      );
    }

    const service = new EdisonAutomationService(repository);
    const renamed = await service.renameFolderId("E2002AAA", "X9000");

    expect(renamed.map((record) => record.document.documentId)).toEqual([
      "X9000AAA",
      "X9000AAA1",
    ]);
    const survivors = await repository.listDocumentIds();
    expect(survivors).toContain("X9000AAA");
    expect(survivors).not.toContain("E2002AAA");
    expect(survivors).not.toContain("E2002AAA1");
  });

  it("rejects an empty folder rename", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);

    await expect(
      service.renameFolderId("E2002AAA", "   "),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("emits audit events for approve, unapprove, edit, comments, delete, and rename", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const auditLog = new InMemoryAuditLog();
    const service = new EdisonAutomationService(repository, auditLog);

    await service.approveDocument("E2002AAA");
    await service.unapproveDocument("E2002AAA");
    await service.saveTranscriptionEdit("E2002AAA", "Edited text");
    await service.saveMetadataComments("E2002AAA", "New comment");
    await service.renameFolderId("E2002AAA", "X9000");
    await service.deleteDocument("X9000AAA");

    const events = await auditLog.list();
    const types = events.map((event) => event.type);
    expect(types).toContain("approved");
    expect(types).toContain("unapproved");
    expect(types).toContain("text_edited");
    expect(types).toContain("comments_edited");
    expect(types).toContain("folder_renamed");
    expect(types).toContain("deleted");
  });

  it("scopes audit events to active or past via getAuditTrail", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const auditLog = new InMemoryAuditLog();
    const service = new EdisonAutomationService(repository, auditLog);

    await service.approveDocument("E2002AAA");
    await service.saveTranscriptionEdit("N042AAA", "Updated text");

    const past = await service.getAuditTrail({ scope: "past" });
    expect(
      past.every((event) =>
        event.documentId ? event.documentId === "E2002AAA" : true,
      ),
    ).toBe(true);

    const active = await service.getAuditTrail({ scope: "active" });
    expect(active.some((event) => event.documentId === "N042AAA")).toBe(true);
    expect(active.some((event) => event.documentId === "E2002AAA")).toBe(false);
  });

  it("exports a single approved document via exportSingleTranscriptionCsv", async () => {
    const repository = new InMemoryEdisonRepository(true);
    const service = new EdisonAutomationService(repository);

    await service.approveDocument("E2002AAA");
    const csv = await service.exportSingleTranscriptionCsv("E2002AAA");

    expect(csv.startsWith("o:id,dcterms:identifier")).toBe(true);
    expect(csv).toContain("E2002AAA");
  });

  it("updates group splits by rebuilding sibling documents", async () => {
    const repository = new InMemoryEdisonRepository(false);
    const file = await makeMultiPageUploadFile(
      "group.pdf",
      "application/pdf",
      4,
    );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const initial = await processSourceFileSubDocuments({
      sourceFile: {
        id: "src-group",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "E2002",
      batchIndex: 1,
      existingIds: new Set(),
      providedDocumentId: "E2002AAB",
      subDocuments: [
        {
          startPage: 1,
          endPage: 2,
          ocrText: "A",
          uncertainReadings: [],
          metadata: {
            title: "Letter A",
            documentType: "correspondence",
            date: "1890",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
        {
          startPage: 3,
          endPage: 4,
          ocrText: "B",
          uncertainReadings: [],
          metadata: {
            title: "Letter B",
            documentType: "correspondence",
            date: "1891",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
      ],
      pageImageUrls: Array.from({ length: 4 }, (_, i) => ({
        pageIndex: i,
        url: `https://blob.example/p${i + 1}.jpg`,
      })),
    });
    for (const sibling of initial.siblings) {
      await repository.saveProcessedDocument(
        sibling.documentPackage,
        sibling.transcription,
        sibling.metadata,
      );
    }

    const service = new EdisonAutomationService(repository);
    const merged = await service.updateGroupSplits("E2002AAB", [
      { startPage: 1, endPage: 4, title: "Combined" },
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0].document.documentId).toBe("E2002AAB");
    expect(merged[0].document.pages.map((p) => p.sourcePage)).toEqual([
      1, 2, 3, 4,
    ]);
    // The new single sibling replaces the second sibling (numeric attachment).
    const survivors = await repository.listDocumentIds();
    expect(survivors).toContain("E2002AAB");
    expect(survivors).not.toContain("E2002AAB1");
  });

  it("rejects splits that do not cover every page", async () => {
    const repository = new InMemoryEdisonRepository(false);
    const file = await makeMultiPageUploadFile(
      "group2.pdf",
      "application/pdf",
      3,
    );
    const bytes = new Uint8Array(await file.arrayBuffer());
    const initial = await processSourceFileSubDocuments({
      sourceFile: {
        id: "src-group2",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "E2002",
      batchIndex: 2,
      existingIds: new Set(),
      providedDocumentId: "E2002AAC",
      subDocuments: [
        {
          startPage: 1,
          endPage: 3,
          ocrText: "",
          uncertainReadings: [],
          metadata: {
            title: "",
            documentType: "",
            date: "",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
      ],
    });
    for (const sibling of initial.siblings) {
      await repository.saveProcessedDocument(
        sibling.documentPackage,
        sibling.transcription,
        sibling.metadata,
      );
    }
    const service = new EdisonAutomationService(repository);
    await expect(
      service.updateGroupSplits("E2002AAC", [
        { startPage: 1, endPage: 2 },
      ]),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
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
      folderId: "E2002",
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
    id: "TESTAAA",
    folderId: "TEST",
    documentId: "TESTAAA",
    title: "Test",
    sourceFile: {
      id: "sf-1",
      name: "test.pdf",
      size: 100,
      mimeType: "application/pdf",
    },
    pages: [
      {
        id: "TESTAAA-page-1",
        documentId: "TESTAAA",
        pageIndex: 0,
        imageFilename: "TEST_Page_01.jpg",
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

describe("validateContiguousSplits", () => {
  it("accepts a single split that covers all pages", () => {
    expect(() =>
      validateContiguousSplits([{ startPage: 1, endPage: 5 }], 5),
    ).not.toThrow();
  });

  it("accepts contiguous splits that cover all pages", () => {
    expect(() =>
      validateContiguousSplits(
        [
          { startPage: 1, endPage: 3 },
          { startPage: 4, endPage: 7 },
          { startPage: 8, endPage: 10 },
        ],
        10,
      ),
    ).not.toThrow();
  });

  it("rejects an empty splits array", () => {
    expect(() => validateContiguousSplits([], 5)).toThrow(/at least one split/);
  });

  it("rejects a gap between splits", () => {
    expect(() =>
      validateContiguousSplits(
        [
          { startPage: 1, endPage: 3 },
          { startPage: 5, endPage: 7 },
        ],
        7,
      ),
    ).toThrow(/must start at page 4/);
  });

  it("rejects an overlap between splits", () => {
    expect(() =>
      validateContiguousSplits(
        [
          { startPage: 1, endPage: 4 },
          { startPage: 3, endPage: 7 },
        ],
        7,
      ),
    ).toThrow(/must start at page 5/);
  });

  it("rejects splits that do not cover the final page", () => {
    expect(() =>
      validateContiguousSplits(
        [
          { startPage: 1, endPage: 3 },
          { startPage: 4, endPage: 5 },
        ],
        7,
      ),
    ).toThrow(/last split ends at 5/);
  });

  it("rejects an endPage beyond the source page count", () => {
    expect(() =>
      validateContiguousSplits([{ startPage: 1, endPage: 9 }], 5),
    ).toThrow(/beyond the source's 5 pages/);
  });
});

describe("normalizeSubDocuments", () => {
  const blankMetadata = {
    title: "",
    documentType: "",
    date: "",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
    places: [],
  };

  function makeSub(
    startPage: number,
    endPage: number,
  ): TranscribedSubDocument {
    return {
      startPage,
      endPage,
      ocrText: "",
      uncertainReadings: [],
      metadata: blankMetadata,
    };
  }

  it("falls back to a single full-document entry when input is empty", () => {
    const result = normalizeSubDocuments([], 6);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ startPage: 1, endPage: 6 });
  });

  it("sorts entries and clamps to the source page count", () => {
    const result = normalizeSubDocuments(
      [makeSub(5, 9), makeSub(1, 2), makeSub(3, 4)],
      6,
    );
    expect(result.map((entry) => [entry.startPage, entry.endPage])).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it("trims overlaps so siblings stay disjoint", () => {
    const result = normalizeSubDocuments(
      [makeSub(1, 4), makeSub(3, 6)],
      6,
    );
    expect(result.map((entry) => [entry.startPage, entry.endPage])).toEqual([
      [1, 4],
      [5, 6],
    ]);
  });

  it("drops entries fully covered by an earlier sibling", () => {
    const result = normalizeSubDocuments(
      [makeSub(1, 5), makeSub(2, 4)],
      5,
    );
    expect(result.map((entry) => [entry.startPage, entry.endPage])).toEqual([
      [1, 5],
    ]);
  });
});

describe("processSourceFileSubDocuments", () => {
  it("produces one sibling for a single-document PDF", async () => {
    const file = await makeMultiPageUploadFile(
      "single.pdf",
      "application/pdf",
      2,
    );
    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await processSourceFileSubDocuments({
      sourceFile: {
        id: "src-single",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "E2002",
      batchIndex: 1,
      existingIds: new Set(),
      providedDocumentId: "E2002AAA",
      subDocuments: [
        {
          startPage: 1,
          endPage: 2,
          ocrText: "Hello",
          uncertainReadings: [],
          metadata: {
            title: "Single doc",
            documentType: "correspondence",
            date: "1890",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
      ],
      pageImageUrls: [
        { pageIndex: 0, url: "https://blob.example/p1.jpg", width: 100, height: 200 },
        { pageIndex: 1, url: "https://blob.example/p2.jpg" },
      ],
    });

    expect(result.blocked).toBe(false);
    expect(result.siblings).toHaveLength(1);
    const [sibling] = result.siblings;
    expect(sibling.documentPackage.documentId).toBe("E2002AAA");
    expect(sibling.documentPackage.pages).toHaveLength(2);
    expect(sibling.documentPackage.pages[0].originalUrl).toBe(
      "https://blob.example/p1.jpg",
    );
    expect(sibling.documentPackage.sourceGroup).toMatchObject({
      groupId: "E2002AAA",
      siblingIds: ["E2002AAA"],
      totalPages: 2,
      position: 0,
    });
    expect(sibling.transcription.diplomaticText).toBe("Hello");
  });

  it("produces N siblings with suffixed ids and per-sibling pages", async () => {
    const file = await makeMultiPageUploadFile(
      "triple.pdf",
      "application/pdf",
      6,
    );
    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await processSourceFileSubDocuments({
      sourceFile: {
        id: "src-triple",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "E2002",
      batchIndex: 1,
      existingIds: new Set(),
      providedDocumentId: "E2002AAF",
      subDocuments: [
        {
          startPage: 1,
          endPage: 2,
          ocrText: "First letter",
          uncertainReadings: [],
          metadata: {
            title: "First",
            documentType: "correspondence",
            date: "1890",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
        {
          startPage: 3,
          endPage: 4,
          ocrText: "Second letter",
          uncertainReadings: [],
          metadata: {
            title: "Second",
            documentType: "correspondence",
            date: "1891",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
        {
          startPage: 5,
          endPage: 6,
          ocrText: "Third letter",
          uncertainReadings: [],
          metadata: {
            title: "Third",
            documentType: "memorandum",
            date: "1892",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
      ],
      pageImageUrls: Array.from({ length: 6 }, (_, i) => ({
        pageIndex: i,
        url: `https://blob.example/p${i + 1}.jpg`,
      })),
    });

    expect(result.blocked).toBe(false);
    expect(result.siblings).toHaveLength(3);
    // Position 0 keeps the base id; subsequent siblings use numeric
    // attachment suffixes matching the TAEP convention.
    expect(result.siblings.map((s) => s.documentPackage.documentId)).toEqual([
      "E2002AAF",
      "E2002AAF1",
      "E2002AAF2",
    ]);

    expect(
      result.siblings.map(
        (s) => s.documentPackage.sourceGroup?.position,
      ),
    ).toEqual([0, 1, 2]);

    expect(
      result.siblings[0].documentPackage.sourceGroup?.siblingIds,
    ).toEqual(["E2002AAF", "E2002AAF1", "E2002AAF2"]);

    const [first, second, third] = result.siblings;
    expect(first.documentPackage.pages.map((p) => p.sourcePage)).toEqual([1, 2]);
    expect(second.documentPackage.pages.map((p) => p.sourcePage)).toEqual([3, 4]);
    expect(third.documentPackage.pages.map((p) => p.sourcePage)).toEqual([5, 6]);

    expect(first.documentPackage.pages[0].originalUrl).toBe(
      "https://blob.example/p1.jpg",
    );
    expect(second.documentPackage.pages[0].originalUrl).toBe(
      "https://blob.example/p3.jpg",
    );
    expect(third.documentPackage.pages[1].originalUrl).toBe(
      "https://blob.example/p6.jpg",
    );

    expect(first.metadata.title).toBe("First");
    expect(second.metadata.title).toBe("Second");
  });

  it("stamps renderError onto every page when rasterization failed", async () => {
    const file = await makeMultiPageUploadFile(
      "broken.pdf",
      "application/pdf",
      2,
    );
    const bytes = new Uint8Array(await file.arrayBuffer());

    const result = await processSourceFileSubDocuments({
      sourceFile: {
        id: "src-broken",
        name: file.name,
        size: file.size,
        mimeType: file.type,
      },
      bytes,
      folderId: "E2002",
      batchIndex: 1,
      existingIds: new Set(),
      providedDocumentId: "E2002AAD",
      subDocuments: [
        {
          startPage: 1,
          endPage: 2,
          ocrText: "x",
          uncertainReadings: [],
          metadata: {
            title: "",
            documentType: "",
            date: "",
            authors: [],
            recipients: [],
            mentionedNames: [],
            subjects: [],
            places: [],
          },
        },
      ],
      pageImageUrls: [],
      rasterizeError: "PDF rasterization failed: boom",
    });

    expect(result.blocked).toBe(false);
    const sibling = result.siblings[0];
    expect(
      sibling.documentPackage.pages.every(
        (p) => p.renderError === "PDF rasterization failed: boom",
      ),
    ).toBe(true);
    expect(sibling.documentPackage.validationWarnings).toContain(
      "PDF rasterization failed: boom",
    );
  });
});

describe("mergeTranscribedMetadata", () => {
  const processed: MetadataExtraction = {
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
    imageNames: ["page.jpg"],
    confidence: "medium",
  };

  it("falls back to the processed subjects when AI returns an empty array", () => {
    const merged = mergeTranscribedMetadata(processed, {
      title: "Marks to Edison",
      documentType: "correspondence",
      date: "1890",
      authors: ["Edison, Thomas A."],
      recipients: [],
      mentionedNames: [],
      subjects: [],
      places: [],
    });

    expect(merged.subjects).toEqual([]);
    expect(merged.documentType).toBe("Letter");
    expect(merged.title).toBe("Marks to Edison");
  });

  it("keeps the processed title when the model returns no title", () => {
    const merged = mergeTranscribedMetadata(processed, {
      title: "",
      documentType: "correspondence",
      date: "1890",
      authors: [],
      recipients: [],
      mentionedNames: [],
      subjects: ["Electric light"],
      places: [],
    });

    expect(merged.title).toBe("[E2002AAA]");
    expect(merged.subjects).toEqual(["Electric light"]);
  });
});
