import { AppError } from "./app-error";
import { createDocumentPackage } from "./extraction";
import {
  buildAgentImprovementScript,
  buildPromptRevisionCandidate,
  suggestConfidenceCalibrations,
  summarizeFeedback,
} from "./feedback-engine";
import { buildOmekaCsv, buildOmekaCsvRow } from "./omeka-export";
import { getActivePrompt } from "./prompts";
import type { EdisonRepository } from "./repositories";
import { summarizeDocuments } from "./repositories";
import type {
  AgentFeedback,
  BoxUpload,
  ConfidenceBucket,
  DocumentPackage,
  FeedbackTarget,
  MetadataExtraction,
  PromptVersion,
  ReviewDecision,
  SourceFile,
  TranscriptionRun,
} from "./types";

export interface UploadFileLike {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ManualIngestInput {
  files: UploadFileLike[];
  folderId?: string;
}

export interface BoxWebhookEvent {
  id: string;
  trigger: string;
  source: {
    id: string;
    type: string;
    name?: string;
    size?: number;
    sha1?: string;
    parent?: {
      id: string;
      name: string;
    };
    path_collection?: {
      entries?: Array<{
        id: string;
        name: string;
        type?: string;
      }>;
    };
  };
}

export interface ProcessSourceFileInput {
  sourceFile: SourceFile;
  bytes: Uint8Array;
  folderId?: string;
  batchIndex: number;
  existingIds: Set<string>;
  rawOcrText?: string;
  model?: string;
}

export interface ProcessSourceFileResult {
  documentPackage: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
  confidence: ConfidenceBucket;
  confidenceReasons: string[];
}

interface ConfidenceInput {
  pageCount: number;
  extractionErrors: number;
  uncertainReadings: number;
  modelDisagreements: number;
  ocrTextLength: number;
}

interface ConfidenceResult {
  bucket: ConfidenceBucket;
  score: number;
  reasons: string[];
}

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];

  if (input.extractionErrors > 0 || input.pageCount === 0) {
    return {
      bucket: "blocked",
      score: 0,
      reasons: ["Extraction failed or produced no reviewable pages."],
    };
  }

  let score = 100;

  if (input.ocrTextLength < 80) {
    score -= 25;
    reasons.push("OCR text is very short for the extracted page count.");
  }

  if (input.uncertainReadings > 0) {
    const penalty = Math.min(30, input.uncertainReadings * 4);
    score -= penalty;
    reasons.push(`${input.uncertainReadings} uncertain readings need review.`);
  }

  if (input.modelDisagreements > 0) {
    const penalty = Math.min(25, input.modelDisagreements * 8);
    score -= penalty;
    reasons.push(`${input.modelDisagreements} model disagreements were detected.`);
  }

  if (input.pageCount > 20) {
    score -= 5;
    reasons.push("Large document packages receive extra review scrutiny.");
  }

  const bucket: ConfidenceBucket =
    score >= 85 ? "high" : score >= 55 ? "medium" : "low";

  return {
    bucket,
    score: Math.max(0, score),
    reasons: reasons.length > 0 ? reasons : ["Clean extraction and low uncertainty."],
  };
}

function extractUncertainReadings(text: string): string[] {
  return text.match(/\[[^\]]+\?\]/g) ?? [];
}

export async function processSourceFile(
  input: ProcessSourceFileInput,
): Promise<ProcessSourceFileResult> {
  const documentPackage = await createDocumentPackage({
    sourceFile: input.sourceFile,
    bytes: input.bytes,
    folderId: input.folderId,
    batchIndex: input.batchIndex,
    existingIds: input.existingIds,
  });

  const blocked = documentPackage.status === "blocked";
  const rawOcrText = input.rawOcrText ?? "";
  const cleanedText = rawOcrText.trim();
  const uncertainReadings = blocked ? [] : extractUncertainReadings(cleanedText);
  const confidenceResult = scoreConfidence({
    pageCount: documentPackage.pages.length,
    extractionErrors: blocked ? 1 : 0,
    uncertainReadings: uncertainReadings.length,
    modelDisagreements: 0,
    ocrTextLength: cleanedText.length,
  });

  const diplomaticPrompt = getActivePrompt("diplomatic-transcription");
  const transcription: TranscriptionRun = {
    id: `${documentPackage.documentId}-run-1`,
    documentId: documentPackage.documentId,
    model: input.model ?? "gateway-configured-model",
    promptVersion: diplomaticPrompt.version,
    ocrText: rawOcrText,
    diplomaticText: cleanedText,
    uncertainReadings,
  };

  const metadata: MetadataExtraction = {
    folderId: documentPackage.folderId,
    documentId: documentPackage.documentId,
    documentType: "Unknown",
    date: "Unknown",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: blocked ? [] : ["Needs review"],
    imageNames: documentPackage.pages.map((page) => page.imageFilename),
    confidence: confidenceResult.bucket,
  };

  return {
    documentPackage,
    transcription,
    metadata,
    confidence: confidenceResult.bucket,
    confidenceReasons: confidenceResult.reasons,
  };
}

export class EdisonAutomationService {
  constructor(private readonly repository: EdisonRepository) {}

  async getDashboard() {
    const documents = await this.repository.listDocuments();
    const boxUploads = await this.repository.listBoxUploads();
    const reviewCase = await this.repository.getReviewCase();

    return {
      summary: summarizeDocuments(documents, boxUploads),
      documents,
      boxUploads,
      reviewCase,
    };
  }

  async ingestManualFiles(input: ManualIngestInput): Promise<DocumentPackage[]> {
    if (input.files.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "Upload at least one file using the files field.",
        400,
      );
    }

    const existingIds = new Set(
      (await this.repository.listDocuments()).map((document) => document.documentId),
    );
    const packages: DocumentPackage[] = [];
    const transcriptions: TranscriptionRun[] = [];
    const metadata: MetadataExtraction[] = [];

    for (const [index, file] of input.files.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sourceFile: SourceFile = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      };
      const processed = await processSourceFile({
        sourceFile,
        bytes,
        folderId: input.folderId,
        batchIndex: index + 1,
        existingIds,
      });
      existingIds.add(processed.documentPackage.documentId);
      packages.push(processed.documentPackage);
      transcriptions.push(processed.transcription);
      metadata.push(processed.metadata);
    }

    await this.repository.saveProcessedDocuments(packages, transcriptions, metadata);
    return packages;
  }

  async handleBoxWebhook(event: BoxWebhookEvent) {
    if (event.trigger !== "FILE.UPLOADED") {
      return {
        accepted: true,
        recorded: false,
        queued: false,
        reason: `Ignored unsupported trigger ${event.trigger}.`,
      };
    }

    const now = new Date().toISOString();
    const pathEntries = event.source.path_collection?.entries ?? [];
    const parent = event.source.parent ?? pathEntries.at(-1);
    const folderName = parent?.name ?? "Unassigned Box folder";
    const folderPath =
      pathEntries.length > 0
        ? pathEntries.map((entry) => entry.name).concat(folderName).join(" / ")
        : folderName;
    const upload: BoxUpload = {
      id: `box-upload-${event.source.id}`,
      webhookEventId: event.id,
      boxFileId: event.source.id,
      fileName: event.source.name ?? "Unknown",
      fileSize: event.source.size,
      checksum: event.source.sha1,
      folderId: parent?.id,
      folderName,
      folderPath,
      status: "available",
      receivedAt: now,
      updatedAt: now,
    };

    await this.repository.saveBoxUpload(upload);

    return {
      accepted: true,
      recorded: true,
      queued: false,
      upload,
      nextAction: "User must click Start transcription in the platform.",
    };
  }

  async startTranscriptionForBoxUpload(uploadId: string) {
    const upload = await this.repository.getBoxUpload(uploadId);
    if (!upload) {
      throw new AppError("NOT_FOUND", "Box upload was not found.", 404);
    }

    if (upload.status !== "available" && upload.status !== "selected_for_transcription") {
      throw new AppError(
        "BAD_REQUEST",
        `Box upload cannot be started from status ${upload.status}.`,
        409,
      );
    }

    const updated: BoxUpload = {
      ...upload,
      status: "queued_for_pipeline",
      updatedAt: new Date().toISOString(),
    };
    await this.repository.updateBoxUpload(updated);

    return {
      accepted: true,
      upload: updated,
      pendingSteps: ["fetch-from-box-bytes", "run-pipeline"],
      note:
        "Byte fetch is performed by a Box worker; the unified pipeline runs once bytes are available.",
    };
  }

  async exportOmekaCsv(): Promise<string> {
    const rows = await this.repository.listApprovedExportRows();
    if (rows.length === 0) {
      throw new AppError(
        "EXPORT_FAILED",
        "No approved records are available for export.",
        409,
      );
    }

    return buildOmekaCsv(
      rows.map((row) => buildOmekaCsvRow(row.metadata, row.transcription)),
    );
  }

  async recordReviewAction(input: {
    documentId: string;
    reviewer: string;
    decision: ReviewDecision;
    note: string;
  }) {
    await this.repository.appendReviewEvent({
      id: crypto.randomUUID(),
      documentId: input.documentId,
      reviewer: input.reviewer,
      decision: input.decision,
      note: input.note,
      createdAt: new Date().toISOString(),
    });
  }

  async recordAgentFeedback(input: {
    documentId: string;
    reviewer: string;
    target: FeedbackTarget;
    originalValue: string;
    correctedValue: string;
    issueTags: string[];
    promptVersion?: string;
    model?: string;
    confidenceBefore?: AgentFeedback["confidenceBefore"];
    confidenceAfter?: AgentFeedback["confidenceAfter"];
  }): Promise<AgentFeedback> {
    if (input.originalValue.trim() === input.correctedValue.trim()) {
      throw new AppError(
        "BAD_REQUEST",
        "Feedback must include a meaningful correction.",
        400,
      );
    }

    const feedback: AgentFeedback = {
      id: crypto.randomUUID(),
      documentId: input.documentId,
      reviewer: input.reviewer,
      target: input.target,
      originalValue: input.originalValue,
      correctedValue: input.correctedValue,
      issueTags: [...new Set(input.issueTags.map((tag) => tag.trim()).filter(Boolean))],
      promptVersion: input.promptVersion,
      model: input.model,
      confidenceBefore: input.confidenceBefore,
      confidenceAfter: input.confidenceAfter,
      createdAt: new Date().toISOString(),
    };

    await this.repository.appendAgentFeedback(feedback);
    return feedback;
  }

  async previewAgentImprovementDraft(task: PromptVersion["task"]) {
    return this.buildAgentImprovementDraft(task, { persist: false });
  }

  async generateAgentImprovementDraft(task: PromptVersion["task"]) {
    return this.buildAgentImprovementDraft(task, { persist: true });
  }

  private async buildAgentImprovementDraft(
    task: PromptVersion["task"],
    options: { persist: boolean },
  ) {
    const allFeedback = await this.repository.listAgentFeedback();
    const promptFeedback = allFeedback.filter(
      (item) => item.target === "prompt" || item.target === "transcription",
    );
    const activePrompt = getActivePrompt(task);
    const candidate = buildPromptRevisionCandidate({
      task,
      basePromptVersion: activePrompt.version,
      basePrompt: activePrompt.prompt,
      feedback: promptFeedback,
    });
    const calibrations = suggestConfidenceCalibrations(allFeedback);

    if (options.persist) {
      await this.repository.savePromptRevisionCandidate(candidate);
    }

    return {
      summary: summarizeFeedback(promptFeedback),
      candidate,
      calibrations,
      agentScript: buildAgentImprovementScript({ candidate, calibrations }),
    };
  }
}
