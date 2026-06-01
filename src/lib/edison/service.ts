import { AppError } from "./app-error";
import { buildAuditTrail, type AuditEvent } from "./audit";
import { extractUncertainReadings, gradeTranscription } from "./confidence";
import { createDocumentPackage } from "./extraction";
import { buildExportCsv, buildExportCsvRow } from "./export-csv";
import { getActivePrompt } from "./prompts";
import type { TranscribedMetadata } from "./transcribe";
import type {
  DashboardSummary,
  EdisonRepository,
  ReviewCase,
} from "./repositories";
import {
  buildReviewCase,
  emptyMetadata,
  emptyTranscription,
  summarizeDocuments,
} from "./repositories";
import type {
  ConfidenceBucket,
  DocumentPackage,
  MetadataExtraction,
  SourceFile,
  TranscriptionRun,
} from "./types";

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
  // Pre-assigned, collision-free document identifier. When supplied (e.g. by the
  // ingest workflow's assignment pre-pass), it is preserved as-is instead of
  // re-deriving an ID from the filename, which avoids races between concurrent
  // files that resolve to the same embedded identifier.
  providedDocumentId?: string;
  rawOcrText?: string;
  model?: string;
  // Per-page durable URLs to render in the viewer. Single-image uploads supply
  // exactly one entry for `pageIndex: 0`; multi-page PDFs are rasterized to
  // JPGs upstream and supply one entry per page. Pages without an entry fall
  // back to the FacsimileSheet placeholder.
  pageImageUrls?: PageImageUrl[];
}

export interface PageImageUrl {
  pageIndex: number;
  url: string;
  width?: number;
  height?: number;
}

export interface ProcessSourceFileResult {
  documentPackage: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
  confidence: ConfidenceBucket;
  confidenceReasons: string[];
}

// Re-exported so existing call sites and tests can keep importing the grader
// from the service module; the implementation lives in ./confidence.
export { scoreConfidence } from "./confidence";

export function resolvePersistedDocumentStatus(
  documentPackage: DocumentPackage,
): DocumentPackage {
  if (documentPackage.status === "queued" && documentPackage.pages.length > 0) {
    return { ...documentPackage, status: "needs_review" };
  }
  return documentPackage;
}

export function mergeTranscribedMetadata(
  processed: MetadataExtraction,
  transcribed?: TranscribedMetadata,
): MetadataExtraction {
  if (!transcribed) {
    return processed;
  }
  return {
    ...processed,
    title: transcribed.title?.trim() || processed.title,
    documentType: transcribed.documentType || "Unknown",
    date: transcribed.date || "Unknown",
    authors: transcribed.authors,
    recipients: transcribed.recipients,
    mentionedNames: transcribed.mentionedNames,
    subjects:
      transcribed.subjects.length > 0
        ? transcribed.subjects
        : processed.subjects,
  };
}

export async function processSourceFile(
  input: ProcessSourceFileInput,
): Promise<ProcessSourceFileResult> {
  const built = await createDocumentPackage({
    sourceFile: input.sourceFile,
    bytes: input.bytes,
    folderId: input.folderId,
    providedDocumentId: input.providedDocumentId,
    batchIndex: input.batchIndex,
    existingIds: input.existingIds,
  });

  // Attach the per-page rendered image URLs supplied by the rasterize step.
  // PDFs come back with one URL per page; image uploads come back with a
  // single entry for page 0. Pages without a URL keep the FacsimileSheet
  // placeholder and a disabled download button in the viewer.
  const urlByPageIndex = new Map<number, PageImageUrl>();
  for (const entry of input.pageImageUrls ?? []) {
    urlByPageIndex.set(entry.pageIndex, entry);
  }
  const packageWithUrls: DocumentPackage =
    urlByPageIndex.size > 0 && built.pages.length > 0
      ? {
          ...built,
          pages: built.pages.map((page) => {
            const match = urlByPageIndex.get(page.pageIndex);
            if (!match) return page;
            return {
              ...page,
              originalUrl: match.url,
              ...(match.width !== undefined ? { width: match.width } : {}),
              ...(match.height !== undefined ? { height: match.height } : {}),
            };
          }),
        }
      : built;

  const blocked = packageWithUrls.status === "blocked";
  const rawOcrText = input.rawOcrText ?? "";
  const cleanedText = rawOcrText.trim();
  const uncertainReadings = blocked ? [] : extractUncertainReadings(cleanedText);
  const confidenceResult = gradeTranscription({
    pageCount: packageWithUrls.pages.length,
    blocked,
    text: cleanedText,
    uncertainReadings: uncertainReadings.length,
  });

  const documentPackage: DocumentPackage = {
    ...packageWithUrls,
    confidence: confidenceResult.bucket,
  };

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
    title: documentPackage.title,
    documentType: "Unknown",
    date: "Unknown",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
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

  async getDashboard(): Promise<{ summary: DashboardSummary }> {
    const documents = await this.repository.listDocuments();
    return { summary: summarizeDocuments(documents) };
  }

  // Loads everything the review page needs in a single store read: the summary
  // counts and the review case are both derived from one records snapshot
  // instead of issuing three separate full-store scans.
  async getReviewWorkbench(documentId?: string): Promise<{
    summary: DashboardSummary;
    reviewCase: ReviewCase | null;
  }> {
    const records = await this.repository.listDocumentRecords();
    return {
      summary: summarizeDocuments(records.documents),
      reviewCase: buildReviewCase(records, documentId),
    };
  }

  async getReviewCase(documentId?: string) {
    return this.repository.getReviewCase(documentId);
  }

  async getDocumentRecord(documentId: string) {
    return this.repository.getDocumentRecord(documentId);
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

  async approveDocument(documentId: string) {
    const record = await this.repository.getDocumentRecord(documentId);
    if (!record) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    if (record.document.status === "blocked") {
      throw new AppError(
        "BAD_REQUEST",
        "Blocked documents cannot be approved for export.",
        409,
      );
    }

    const updated = await this.repository.approveDocument(documentId);
    if (!updated) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    return updated;
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

  async exportTranscriptionsCsv(): Promise<string> {
    const rows = await this.repository.listApprovedExportRows();
    if (rows.length === 0) {
      throw new AppError(
        "EXPORT_FAILED",
        "No approved records are available for export.",
        409,
      );
    }

    return buildExportCsv(
      rows.map((row) => buildExportCsvRow(row.metadata, row.transcription)),
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
    buildExportCsv(
      rows.map((row) => buildExportCsvRow(row.metadata, row.transcription)),
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
      "- index.csv             CSV index of transcriptions and metadata",
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

