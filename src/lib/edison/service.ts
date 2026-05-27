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
  DocumentPackage,
  FeedbackTarget,
  PromptVersion,
  ReviewDecision,
  SourceFile,
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
  };
}

export class EdisonAutomationService {
  constructor(private readonly repository: EdisonRepository) {}

  async getDashboard() {
    const documents = await this.repository.listDocuments();
    const reviewCase = await this.repository.getReviewCase();

    return {
      summary: summarizeDocuments(documents),
      documents,
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

    for (const [index, file] of input.files.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sourceFile: SourceFile = {
        id: `manual-${Date.now()}-${index + 1}`,
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      };
      const documentPackage = await createDocumentPackage({
        sourceFile,
        bytes,
        folderId: input.folderId,
        batchIndex: index + 1,
        existingIds,
      });
      existingIds.add(documentPackage.documentId);
      packages.push(documentPackage);
    }

    await this.repository.saveDocuments(packages);
    return packages;
  }

  handleBoxWebhook(event: BoxWebhookEvent) {
    if (event.trigger !== "FILE.UPLOADED") {
      return {
        accepted: true,
        queued: false,
        reason: `Ignored unsupported trigger ${event.trigger}.`,
      };
    }

    return {
      accepted: true,
      queued: true,
      job: {
        webhookEventId: event.id,
        boxFileId: event.source.id,
        fileName: event.source.name ?? "Unknown",
        checksum: event.source.sha1,
      },
    };
  }

  async exportOmekaCsv(): Promise<string> {
    const rows = await this.repository.listApprovedExportRows();
    if (rows.length === 0) {
      throw new AppError("EXPORT_FAILED", "No approved or reviewable records are available for export.", 409);
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

  async generateAgentImprovementDraft(task: PromptVersion["task"]) {
    const feedback = (await this.repository.listAgentFeedback()).filter(
      (item) => item.target === "prompt" || item.target === "transcription",
    );
    const activePrompt = getActivePrompt(task);
    const candidate = buildPromptRevisionCandidate({
      task,
      basePromptVersion: activePrompt.version,
      basePrompt: activePrompt.prompt,
      feedback,
    });
    const calibrations = suggestConfidenceCalibrations(
      await this.repository.listAgentFeedback(),
    );

    await this.repository.savePromptRevisionCandidate(candidate);

    return {
      summary: summarizeFeedback(feedback),
      candidate,
      calibrations,
      agentScript: buildAgentImprovementScript({ candidate, calibrations }),
    };
  }
}
