import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { InMemoryEdisonRepository } from "./in-memory-repository";
import { EdisonAutomationService, processSourceFile } from "./service";

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
