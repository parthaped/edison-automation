import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { InMemoryEdisonRepository } from "./in-memory-repository";
import { EdisonAutomationService } from "./service";

async function makeUploadFile(name: string, type: string): Promise<File> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const bytes = await pdf.save();
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new File([arrayBuffer], name, { type });
}

describe("EdisonAutomationService", () => {
  it("builds dashboard data through the repository boundary", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(true));

    const dashboard = await service.getDashboard();

    expect(dashboard.summary.total).toBeGreaterThan(0);
    expect(dashboard.reviewCase?.documents.length).toBeGreaterThan(0);
  });

  it("ingests manual files and persists document packages", async () => {
    const repository = new InMemoryEdisonRepository(false);
    const service = new EdisonAutomationService(repository);
    const file = await makeUploadFile("D9032-00001.pdf", "application/pdf");

    const { packages } = await service.ingestManualFiles({
      files: [file],
      folderId: "D9032-F",
    });

    expect(packages[0].documentId).toBe("D9032-00001");
    expect(await repository.listDocuments()).toHaveLength(1);
  });

  it("rejects empty manual ingest requests with structured errors", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(false));

    await expect(service.ingestManualFiles({ files: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
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
