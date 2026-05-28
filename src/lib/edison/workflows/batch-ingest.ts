import {
  FatalError,
  RetryableError,
  getWritable,
} from "workflow";
import type { BatchEvent } from "../ingest-job-store";
import { processSourceFile } from "../service";
import type {
  ManualIngestResult,
  TranscriptionError,
} from "../service";
import { getEdisonService } from "../service-factory";
import {
  isTranscribableMediaType,
  transcribeDocument,
  type TranscribedMetadata,
} from "../transcribe";
import type {
  DocumentPackage,
  MetadataExtraction,
  SourceFile,
  TranscriptionRun,
} from "../types";

export interface BlobRef {
  url: string;
  name: string;
  size: number;
  contentType: string;
}

export interface BatchIngestWorkflowInput {
  folderId?: string;
  blobs: BlobRef[];
  promptTask?: "diplomatic-transcription" | "project-notebook";
}

interface FileResult {
  fileName: string;
  documentId: string;
  documentPackage: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
  errors: TranscriptionError[];
}

interface FileFailure {
  fileName: string;
  message: string;
}

const MAX_CONCURRENCY = 3;

// ---------- workflow ----------

export async function batchIngestWorkflow(
  input: BatchIngestWorkflowInput,
): Promise<ManualIngestResult> {
  "use workflow";

  const aiEnabled = Boolean(process.env.AI_GATEWAY_API_KEY);

  await emitBatchStartedStep({
    folderId: input.folderId,
    files: input.blobs.map((blob) => ({ name: blob.name, size: blob.size })),
  });

  const results: FileResult[] = [];
  const failures: FileFailure[] = [];

  for (
    let chunkStart = 0;
    chunkStart < input.blobs.length;
    chunkStart += MAX_CONCURRENCY
  ) {
    const chunk = input.blobs.slice(chunkStart, chunkStart + MAX_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((blob, offset) =>
        processOneFile({
          folderId: input.folderId,
          blob,
          promptTask: input.promptTask ?? "diplomatic-transcription",
          batchIndex: chunkStart + offset + 1,
          aiEnabled,
        }),
      ),
    );

    for (const [index, outcome] of settled.entries()) {
      const blob = chunk[index];
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        const message =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
        failures.push({ fileName: blob.name, message });
        await emitFileFailedStep({ fileName: blob.name, message });
      }
    }
  }

  const aggregated = buildResult(results);
  await finalizeBatchStep({
    results,
    failures,
    aggregated,
  });

  // Source blobs are intentionally retained: image pages reference the blob URL
  // so the side-by-side viewer can render the original document.
  return aggregated;
}

// ---------- per-file orchestration (not a step) ----------
//
// Runs the file's steps sequentially. Each `"use step"` it awaits is its own
// serverless invocation with its own time budget, so no single invocation runs
// more than one AI call. This keeps every step comfortably under the Hobby
// plan's 60s function ceiling. This helper itself must not emit events (the
// workflow body replays on every step completion, which would duplicate them);
// all emissions happen inside the steps.

interface ProcessOneFileInput {
  folderId?: string;
  blob: BlobRef;
  promptTask: "diplomatic-transcription" | "project-notebook";
  batchIndex: number;
  aiEnabled: boolean;
}

async function processOneFile(input: ProcessOneFileInput): Promise<FileResult> {
  const { folderId, blob, promptTask, batchIndex, aiEnabled } = input;

  const transcribed = await transcribeFileStep({ blob, promptTask, aiEnabled });

  const persisted = await persistFileStep({
    folderId,
    blob,
    batchIndex,
    ocrText: transcribed.ocrText,
    model: transcribed.model,
    inputTokens: transcribed.inputTokens,
    outputTokens: transcribed.outputTokens,
    metadata: transcribed.metadata,
  });

  return {
    fileName: blob.name,
    documentId: persisted.documentPackage.documentId,
    documentPackage: persisted.documentPackage,
    transcription: persisted.transcription,
    metadata: persisted.metadata,
    errors: transcribed.errors,
  };
}

// ---------- steps ----------

async function emitBatchStartedStep(input: {
  folderId?: string;
  files: Array<{ name: string; size?: number }>;
}): Promise<void> {
  "use step";
  console.info("[batch-ingest] started", {
    totalFiles: input.files.length,
    folderId: input.folderId,
  });
  await emitEvent({
    type: "batch-started",
    folderId: input.folderId,
    files: input.files,
    startedAt: new Date().toISOString(),
  });
}

interface TranscribeFileStepInput {
  blob: BlobRef;
  promptTask: "diplomatic-transcription" | "project-notebook";
  aiEnabled: boolean;
}

interface TranscribeFileStepResult {
  ocrText?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  metadata?: TranscribedMetadata;
  errors: TranscriptionError[];
}

// Step 1: fetch the blob and run the single OCR/HTR + indexing model call. This
// is the only AI request per file; metadata is produced in the same call so a
// rate-limited index can never fail a file on its own.
async function transcribeFileStep(
  input: TranscribeFileStepInput,
): Promise<TranscribeFileStepResult> {
  "use step";

  const { blob, promptTask, aiEnabled } = input;
  console.info("[batch-ingest] file:start", { fileName: blob.name });

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "fetching",
    at: new Date().toISOString(),
  });

  const bytes = await fetchBlobBytes(blob);
  const errors: TranscriptionError[] = [];

  if (aiEnabled && isTranscribableMediaType(blob.contentType)) {
    await emitEvent({
      type: "file-stage",
      fileName: blob.name,
      stage: "transcribing",
      at: new Date().toISOString(),
    });
    try {
      const transcribed = await transcribeDocument({
        bytes,
        mediaType: blob.contentType,
        promptTask,
      });
      return {
        ocrText: transcribed.ocrText,
        model: transcribed.model,
        inputTokens: transcribed.inputTokens,
        outputTokens: transcribed.outputTokens,
        metadata: transcribed.metadata,
        errors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({ fileName: blob.name, stage: "transcription", message });
      if (isTransientError(error)) {
        throw new RetryableError(
          `Transcription failed for ${blob.name}: ${message}`,
        );
      }
    }
  }

  return { errors };
}

interface PersistFileStepInput {
  folderId?: string;
  blob: BlobRef;
  batchIndex: number;
  ocrText?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  metadata?: TranscribedMetadata;
}

interface PersistFileStepResult {
  documentPackage: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
}

// Step 2: extract pages, merge the folded metadata, and persist the document
// (no AI call). Source image URLs from the retained blob are attached so the
// viewer can render the original alongside the transcription.
async function persistFileStep(
  input: PersistFileStepInput,
): Promise<PersistFileStepResult> {
  "use step";

  const { folderId, blob, batchIndex, ocrText, model } = input;

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "saving",
    at: new Date().toISOString(),
  });

  const bytes = await fetchBlobBytes(blob);
  const sourceFile: SourceFile = {
    id: crypto.randomUUID(),
    name: blob.name,
    size: blob.size,
    mimeType: blob.contentType,
  };

  const repository = getEdisonService().getRepository();
  const existingIds = new Set(
    (await repository.listDocuments()).map((document) => document.documentId),
  );

  const processed = await processSourceFile({
    sourceFile,
    bytes,
    folderId,
    batchIndex,
    existingIds,
    rawOcrText: ocrText,
    model,
    sourceUrl: blob.url,
  });

  const transcription: TranscriptionRun = {
    ...processed.transcription,
    inputTokens: input.inputTokens ?? processed.transcription.inputTokens,
    outputTokens: input.outputTokens ?? processed.transcription.outputTokens,
  };
  const documentPackage: DocumentPackage =
    ocrText !== undefined && processed.documentPackage.status === "queued"
      ? { ...processed.documentPackage, status: "needs_review" }
      : processed.documentPackage;

  // Merge the structured metadata the model returned in the transcription call.
  const metadata: MetadataExtraction = input.metadata
    ? {
        ...processed.metadata,
        documentType: input.metadata.documentType || "Unknown",
        date: input.metadata.date || "Unknown",
        authors: input.metadata.authors,
        recipients: input.metadata.recipients,
        mentionedNames: input.metadata.mentionedNames,
        subjects: input.metadata.subjects,
      }
    : processed.metadata;

  await repository.saveProcessedDocument(documentPackage, transcription, metadata);

  await emitEvent({
    type: "file-completed",
    fileName: blob.name,
    documentId: documentPackage.documentId,
    at: new Date().toISOString(),
  });
  console.info("[batch-ingest] file:done", {
    fileName: blob.name,
    documentId: documentPackage.documentId,
  });

  return { documentPackage, transcription, metadata };
}

async function emitFileFailedStep(input: {
  fileName: string;
  message: string;
}): Promise<void> {
  "use step";
  console.warn("[batch-ingest] file:failed", input);
  await emitEvent({
    type: "file-failed",
    fileName: input.fileName,
    message: input.message,
    at: new Date().toISOString(),
  });
}

async function finalizeBatchStep(input: {
  results: FileResult[];
  failures: FileFailure[];
  aggregated: ManualIngestResult;
}): Promise<void> {
  "use step";

  const { results, failures, aggregated } = input;
  const status: "completed" | "failed" =
    results.length > 0 ? "completed" : "failed";
  console.info("[batch-ingest] finalize", {
    completed: results.length,
    failed: failures.length,
    status,
  });

  const at = new Date().toISOString();
  if (status === "completed") {
    await emitEvent({
      type: "batch-completed",
      at,
      result: aggregated,
      completedFiles: results.length,
      failedFiles: failures.length,
    });
  } else {
    await emitEvent({
      type: "batch-failed",
      at,
      message:
        failures
          .map((failure) => `${failure.fileName}: ${failure.message}`)
          .join("; ") || "Batch failed with no successful files.",
      completedFiles: results.length,
      failedFiles: failures.length,
      result: aggregated,
    });
  }
}

// ---------- helpers ----------

function buildResult(results: FileResult[]): ManualIngestResult {
  return {
    packages: results.map((entry) => entry.documentPackage),
    transcriptions: results.map((entry) => entry.transcription),
    metadata: results.map((entry) => entry.metadata),
    transcriptionErrors: results.flatMap((entry) => entry.errors),
  };
}

async function fetchBlobBytes(blob: BlobRef): Promise<Uint8Array> {
  const response = await fetch(blob.url);
  if (response.status === 404 || response.status === 410) {
    throw new FatalError(
      `Blob ${blob.name} no longer exists (${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new RetryableError(
      `Failed to fetch blob ${blob.name}: ${response.status}`,
    );
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("503") ||
    message.includes("network") ||
    message.includes("fetch failed")
  );
}

async function emitEvent(event: BatchEvent): Promise<void> {
  const writer = getWritable<BatchEvent>().getWriter();
  try {
    await writer.write(event);
  } finally {
    writer.releaseLock();
  }
}
