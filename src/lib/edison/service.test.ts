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

  it("records Box upload events without starting transcription", async () => {
    const repository = new InMemoryEdisonRepository(false);
    const service = new EdisonAutomationService(repository);

    const result = await service.handleBoxWebhook({
      id: "event-1",
      trigger: "FILE.UPLOADED",
      source: {
        id: "file-1",
        type: "file",
        name: "scan.pdf",
        parent: { id: "folder-1", name: "D9032-F" },
      },
    });

    expect(result.recorded).toBe(true);
    expect(result.queued).toBe(false);
    expect((await repository.listBoxUploads())[0].folderName).toBe("D9032-F");
  });

  it("starts transcription only after user action", async () => {
    const repository = new InMemoryEdisonRepository(false);
    const service = new EdisonAutomationService(repository);

    await service.handleBoxWebhook({
      id: "event-1",
      trigger: "FILE.UPLOADED",
      source: { id: "file-1", type: "file", name: "scan.pdf" },
    });

    const result = await service.startTranscriptionForBoxUpload("box-upload-file-1");

    expect(result.accepted).toBe(true);
    expect(result.upload.status).toBe("queued_for_pipeline");
    expect(result.pipelineJob.steps).toContain("run-agi-transcription-pipeline");
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
