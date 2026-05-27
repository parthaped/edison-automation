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
      name: "D9032-00001.pdf",
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

  it("creates a document package with ordered page image names", async () => {
    const bytes = await makePdf(2);
    const sourceFile: SourceFile = {
      id: "source-1",
      name: "D9032-00001.pdf",
      size: bytes.length,
      mimeType: "application/pdf",
    };

    const documentPackage = await createDocumentPackage({
      sourceFile,
      bytes,
      folderId: "D9032-F",
      batchIndex: 1,
      existingIds: new Set(),
    });

    expect(documentPackage.documentId).toBe("D9032-00001");
    expect(documentPackage.pages).toHaveLength(2);
    expect(documentPackage.pages[1].imageFilename).toBe("D9032-00001/d9032-00001_0002.jpg");
  });
});
