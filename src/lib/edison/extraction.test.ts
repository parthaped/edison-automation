import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { createDocumentPackage, createExtractionPlan } from "./extraction";
import type { SourceFile } from "./types";

async function makePdf(pageCount: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    pdf.addPage([200, 200]);
  }
  return pdf.save();
}

describe("extraction", () => {
  it("counts pages in a PDF", async () => {
    const bytes = await makePdf(3);
    const sourceFile: SourceFile = {
      id: "source-1",
      name: "E2002.pdf",
      size: bytes.length,
      mimeType: "application/pdf",
    };

    const plan = await createExtractionPlan(sourceFile, bytes);

    expect(plan.kind).toBe("pdf");
    expect(plan.pageCount).toBe(3);
  });

  it("blocks corrupt PDFs without throwing", async () => {
    const sourceFile: SourceFile = {
      id: "source-1",
      name: "broken.pdf",
      size: 9,
      mimeType: "application/pdf",
    };

    const plan = await createExtractionPlan(sourceFile, new TextEncoder().encode("%PDF-nope"));

    expect(plan.pageCount).toBe(0);
    expect(plan.blockedReason).toContain("could not be opened");
  });

  it("creates a document package with TAEP-style image filenames", async () => {
    const bytes = await makePdf(2);
    const sourceFile: SourceFile = {
      id: "source-1",
      name: "E2002.pdf",
      size: bytes.length,
      mimeType: "application/pdf",
    };

    const documentPackage = await createDocumentPackage({
      sourceFile,
      bytes,
      folderId: "E2002",
      batchIndex: 1,
      existingIds: new Set(),
    });

    expect(documentPackage.documentId).toBe("E2002AAA");
    expect(documentPackage.pages).toHaveLength(2);
    expect(documentPackage.pages[1].imageFilename).toBe("E2002_Page_02.jpg");
  });

  it("defaults the folder id to the file name stem when omitted", async () => {
    const bytes = await makePdf(1);
    const sourceFile: SourceFile = {
      id: "source-1",
      name: "E2002.pdf",
      size: bytes.length,
      mimeType: "application/pdf",
    };

    const documentPackage = await createDocumentPackage({
      sourceFile,
      bytes,
      batchIndex: 1,
      existingIds: new Set(),
    });

    expect(documentPackage.folderId).toBe("E2002");
    expect(documentPackage.documentId).toBe("E2002AAA");
    expect(documentPackage.pages[0].imageFilename).toBe("E2002_Page_01.jpg");
  });
});
