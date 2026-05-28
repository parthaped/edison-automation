import { AppError } from "./app-error";
import { buildAuditTrail, type AuditEvent } from "./audit";
import { createDocumentPackage } from "./extraction";
import { buildOmekaCsv, buildOmekaCsvRow } from "./omeka-export";
import { getActivePrompt } from "./prompts";
import type { EdisonRepository } from "./repositories";
import { summarizeDocuments } from "./repositories";
import {
  isTranscribableMediaType,
  transcribeDocument,
  type TranscribedMetadata,
} from "./transcribe";
import type {
  ConfidenceBucket,
  DocumentPackage,
  MetadataExtraction,
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
  onProgress?: (progress: ManualIngestProgress) => void;
}

export interface TranscriptionError {
  fileName: string;
  stage: "transcription" | "metadata";
  message: string;
}

export interface ManualIngestResult {
  packages: DocumentPackage[];
  transcriptions: TranscriptionRun[];
  metadata: MetadataExtraction[];
  transcriptionErrors: TranscriptionError[];
}

export interface ManualIngestProgress {
  fileName: string;
  stage: "transcribing" | "extracting" | "metadata" | "saving";
  processedFiles: number;
  totalFiles: number;
}

export interface BatchExportRow {
  document: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
}

export interface BatchExportPayload {
  packages: DocumentPackage[];
  transcriptions: TranscriptionRun[];
  metadata: MetadataExtraction[];
}

export interface ProcessSourceFileInput {
  sourceFile: SourceFile;
  bytes: Uint8Array;
  folderId?: string;
  batchIndex: number;
  existingIds: Set<string>;
  rawOcrText?: string;
  model?: string;
  // Durable URL of the retained source file. Attached to image pages so the
  // viewer can render the original alongside the transcription.
  sourceUrl?: string;
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
  const built = await createDocumentPackage({
    sourceFile: input.sourceFile,
    bytes: input.bytes,
    folderId: input.folderId,
    batchIndex: input.batchIndex,
    existingIds: input.existingIds,
  });

  // Attach the retained source URL to image pages so the viewer renders the
  // original. Single-image uploads have exactly one page; multi-page PDFs are
  // not rasterized per page, so they keep the facsimile placeholder.
  const isImageSource = input.sourceFile.mimeType.toLowerCase().startsWith("image/");
  const documentPackage: DocumentPackage =
    input.sourceUrl && isImageSource
      ? {
          ...built,
          pages: built.pages.map((page) =>
            page.pageIndex === 0
              ? { ...page, originalUrl: input.sourceUrl }
              : page,
          ),
        }
      : built;

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

  getRepository(): EdisonRepository {
    return this.repository;
  }

  async getDashboard() {
    const documents = await this.repository.listDocuments();
    const reviewCase = await this.repository.getReviewCase();

    return {
      summary: summarizeDocuments(documents),
      documents,
      reviewCase,
    };
  }

  async getReviewCase(documentId?: string) {
    return this.repository.getReviewCase(documentId);
  }

  async getAuditTrail(): Promise<AuditEvent[]> {
    const records = await this.repository.listDocumentRecords();
    return buildAuditTrail(records);
  }

  async saveTranscriptionEdit(documentId: string, diplomaticText: string) {
    const updated = await this.repository.updateTranscriptionText(
      documentId,
      diplomaticText,
    );
    if (!updated) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    return updated;
  }

  async ingestManualFiles(
    input: ManualIngestInput,
  ): Promise<ManualIngestResult> {
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
    const transcriptionErrors: TranscriptionError[] = [];
    const aiGatewayConfigured = Boolean(process.env.AI_GATEWAY_API_KEY);

    const totalFiles = input.files.length;
    for (const [index, file] of input.files.entries()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const sourceFile: SourceFile = {
        id: crypto.randomUUID(),
        name: file.name,
        size: file.size,
        mimeType: file.type || "application/octet-stream",
      };

      let rawOcrText: string | undefined;
      let transcribeModel: string | undefined;
      let transcribeInputTokens: number | undefined;
      let transcribeOutputTokens: number | undefined;
      let foldedMetadata: TranscribedMetadata | undefined;

      if (aiGatewayConfigured && isTranscribableMediaType(sourceFile.mimeType)) {
        try {
          input.onProgress?.({
            fileName: sourceFile.name,
            stage: "transcribing",
            processedFiles: index,
            totalFiles,
          });
          const transcribed = await transcribeDocument({
            bytes,
            mediaType: sourceFile.mimeType,
          });
          rawOcrText = transcribed.ocrText;
          transcribeModel = transcribed.model;
          transcribeInputTokens = transcribed.inputTokens;
          transcribeOutputTokens = transcribed.outputTokens;
          foldedMetadata = transcribed.metadata;
        } catch (error) {
          transcriptionErrors.push({
            fileName: sourceFile.name,
            stage: "transcription",
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }

      input.onProgress?.({
        fileName: sourceFile.name,
        stage: "extracting",
        processedFiles: index,
        totalFiles,
      });
      const processed = await processSourceFile({
        sourceFile,
        bytes,
        folderId: input.folderId,
        batchIndex: index + 1,
        existingIds,
        rawOcrText,
        model: transcribeModel,
      });
      existingIds.add(processed.documentPackage.documentId);

      // Metadata is produced in the same call as the transcription, so it
      // never fails the file on its own. Fall back to base metadata otherwise.
      const documentMetadata: MetadataExtraction = foldedMetadata
        ? {
            ...processed.metadata,
            documentType: foldedMetadata.documentType || "Unknown",
            date: foldedMetadata.date || "Unknown",
            authors: foldedMetadata.authors,
            recipients: foldedMetadata.recipients,
            mentionedNames: foldedMetadata.mentionedNames,
            subjects: foldedMetadata.subjects,
          }
        : processed.metadata;

      const transcription: TranscriptionRun = {
        ...processed.transcription,
        inputTokens: transcribeInputTokens ?? processed.transcription.inputTokens,
        outputTokens: transcribeOutputTokens ?? processed.transcription.outputTokens,
      };

      // Real transcription was produced: move out of "queued" so the document
      // surfaces in the reviewer workbench.
      const documentPackage: DocumentPackage =
        rawOcrText !== undefined && processed.documentPackage.status === "queued"
          ? { ...processed.documentPackage, status: "needs_review" }
          : processed.documentPackage;

      packages.push(documentPackage);
      transcriptions.push(transcription);
      metadata.push(documentMetadata);
      input.onProgress?.({
        fileName: sourceFile.name,
        stage: "saving",
        processedFiles: index + 1,
        totalFiles,
      });
    }

    await this.repository.saveProcessedDocuments(packages, transcriptions, metadata);
    return { packages, transcriptions, metadata, transcriptionErrors };
  }

  async buildBatchExportFromPayload(
    payload: BatchExportPayload,
  ): Promise<{ bytes: Uint8Array; fileName: string; documentCount: number }> {
    if (payload.packages.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "Payload must include at least one document package.",
        400,
      );
    }

    const transcriptionsById = new Map(
      payload.transcriptions.map((entry) => [entry.documentId, entry]),
    );
    const metadataById = new Map(
      payload.metadata.map((entry) => [entry.documentId, entry]),
    );

    const rows: BatchExportRow[] = payload.packages.map((document) => ({
      document,
      transcription:
        transcriptionsById.get(document.documentId) ??
        emptyTranscription(document.documentId),
      metadata:
        metadataById.get(document.documentId) ?? emptyMetadata(document),
    }));

    return buildBatchZip(rows);
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
}

async function buildBatchZip(rows: BatchExportRow[]): Promise<{
  bytes: Uint8Array;
  fileName: string;
  documentCount: number;
}> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const exportedAt = new Date().toISOString();

  zip.file(
    "index.csv",
    buildOmekaCsv(
      rows.map((row) => buildOmekaCsvRow(row.metadata, row.transcription)),
    ),
  );
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        exportedAt,
        documentCount: rows.length,
        documents: rows.map((row) => ({
          documentId: row.document.documentId,
          folderId: row.document.folderId,
          title: row.document.title,
          status: row.document.status,
          confidence: row.document.confidence,
          sourceFile: row.document.sourceFile,
          transcription: row.transcription,
          metadata: row.metadata,
        })),
      },
      null,
      2,
    ),
  );
  zip.file(
    "README.txt",
    [
      "Edison Automation export",
      `Exported at: ${exportedAt}`,
      `Documents: ${rows.length}`,
      "",
      "Files:",
      "- index.csv             Omeka-compatible CSV index",
      "- manifest.json         Full structured metadata + transcription JSON",
      "- <documentId>/         Per-document folder",
      "    transcription.txt   Diplomatic transcription as plain text",
      "    metadata.json       Extracted metadata (document type, date, names, subjects)",
      "    source.json         Source file descriptor (name, size, mime type)",
    ].join("\n"),
  );

  for (const row of rows) {
    const folder = zip.folder(row.document.documentId);
    if (!folder) continue;
    folder.file(
      "transcription.txt",
      row.transcription.diplomaticText || row.transcription.ocrText || "",
    );
    folder.file("metadata.json", JSON.stringify(row.metadata, null, 2));
    folder.file(
      "source.json",
      JSON.stringify(row.document.sourceFile, null, 2),
    );
  }

  const buffer = await zip.generateAsync({ type: "uint8array" });
  const timestamp = exportedAt
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return {
    bytes: buffer,
    fileName: `edison-batch-${timestamp}.zip`,
    documentCount: rows.length,
  };
}

function emptyTranscription(documentId: string): TranscriptionRun {
  return {
    id: `${documentId}-pending-transcription`,
    documentId,
    model: "not-run",
    promptVersion: "not-run",
    ocrText: "",
    diplomaticText: "",
    uncertainReadings: [],
  };
}

function emptyMetadata(document: DocumentPackage): MetadataExtraction {
  return {
    folderId: document.folderId,
    documentId: document.documentId,
    documentType: "Unknown",
    date: "Unknown",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
    imageNames: document.pages.map((page) => page.imageFilename),
    confidence: document.confidence,
  };
}
