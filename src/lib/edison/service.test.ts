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

    const packages = await service.ingestManualFiles({
      files: [file],
      folderId: "D9032-F",
    });

    expect(packages[0].documentId).toBe("D9032-00001");
    expect((await repository.listDocuments())).toHaveLength(1);
  });

  it("rejects empty manual ingest requests with structured errors", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(false));

    await expect(service.ingestManualFiles({ files: [] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
  });

  it("exports CSV through approved/reviewable repository rows", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(true));

    const csv = await service.exportOmekaCsv();

    expect(csv).toContain("Folder ID,Doc ID");
    expect(csv).toContain("D9032-F");
  });

  it("converts Box upload events to queue jobs without downloading in the webhook request", () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(false));

    const result = service.handleBoxWebhook({
      id: "event-1",
      trigger: "FILE.UPLOADED",
      source: { id: "file-1", type: "file", name: "scan.pdf" },
    });

    expect(result.queued).toBe(true);
    expect(result.job?.boxFileId).toBe("file-1");
  });

  it("records feedback and generates an agent improvement draft", async () => {
    const service = new EdisonAutomationService(new InMemoryEdisonRepository(true));
    await service.recordAgentFeedback({
      documentId: "D9032-00001",
      reviewer: "Archivist",
      target: "transcription",
      originalValue: "filament",
      correctedValue: "[filament?]",
      issueTags: ["missed-uncertainty"],
      confidenceBefore: "high",
      confidenceAfter: "medium",
    });

    const improvement = await service.generateAgentImprovementDraft(
      "diplomatic-transcription",
    );

    expect(improvement.summary.total).toBe(1);
    expect(improvement.candidate.proposedPrompt).toContain("Mark uncertain words");
    expect(improvement.agentScript).toContain("Promotion Checklist");
  });
});
