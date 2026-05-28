import { del } from "@vercel/blob";
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
  extractMetadata,
  isTranscribableMediaType,
  transcribeDocument,
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
      chunk.map((blob) =>
        processFileStep({
          folderId: input.folderId,
          blob,
          promptTask: input.promptTask ?? "diplomatic-transcription",
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
  await cleanupBlobsStep(input.blobs.map((blob) => blob.url));

  return aggregated;
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

interface ProcessFileStepInput {
  folderId?: string;
  blob: BlobRef;
  promptTask: "diplomatic-transcription" | "project-notebook";
}

async function processFileStep(
  input: ProcessFileStepInput,
): Promise<FileResult> {
  "use step";

  const { folderId, blob, promptTask } = input;
  console.info("[batch-ingest] file:start", { fileName: blob.name });

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "fetching",
    at: new Date().toISOString(),
  });

  const bytes = await fetchBlobBytes(blob);

  let rawOcrText: string | undefined;
  let transcribeModel: string | undefined;
  let transcribeInputTokens: number | undefined;
  let transcribeOutputTokens: number | undefined;
  const errors: TranscriptionError[] = [];

  if (
    process.env.AI_GATEWAY_API_KEY &&
    isTranscribableMediaType(blob.contentType)
  ) {
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
      rawOcrText = transcribed.ocrText;
      transcribeModel = transcribed.model;
      transcribeInputTokens = transcribed.inputTokens;
      transcribeOutputTokens = transcribed.outputTokens;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({
        fileName: blob.name,
        stage: "transcription",
        message,
      });
      if (isTransientError(error)) {
        throw new RetryableError(
          `Transcription failed for ${blob.name}: ${message}`,
        );
      }
    }
  }

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
    batchIndex: 1,
    existingIds,
    rawOcrText,
    model: transcribeModel,
  });

  let documentMetadata: MetadataExtraction = processed.metadata;
  if (
    process.env.AI_GATEWAY_API_KEY &&
    rawOcrText &&
    rawOcrText.trim().length > 0
  ) {
    await emitEvent({
      type: "file-stage",
      fileName: blob.name,
      stage: "indexing",
      at: new Date().toISOString(),
    });
    try {
      const indexed = await extractMetadata({
        documentId: processed.documentPackage.documentId,
        folderId: processed.documentPackage.folderId,
        imageNames: processed.metadata.imageNames,
        ocrText: rawOcrText,
        confidence: processed.confidence,
      });
      documentMetadata = indexed.metadata;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push({
        fileName: blob.name,
        stage: "metadata",
        message,
      });
      if (isTransientError(error)) {
        throw new RetryableError(
          `Metadata extraction failed for ${blob.name}: ${message}`,
        );
      }
    }
  }

  const transcription: TranscriptionRun = {
    ...processed.transcription,
    inputTokens: transcribeInputTokens ?? processed.transcription.inputTokens,
    outputTokens:
      transcribeOutputTokens ?? processed.transcription.outputTokens,
  };
  const documentPackage: DocumentPackage =
    rawOcrText !== undefined && processed.documentPackage.status === "queued"
      ? { ...processed.documentPackage, status: "needs_review" }
      : processed.documentPackage;

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "saving",
    at: new Date().toISOString(),
  });
  await repository.saveProcessedDocument(
    documentPackage,
    transcription,
    documentMetadata,
  );

  const finishedAt = new Date().toISOString();
  await emitEvent({
    type: "file-completed",
    fileName: blob.name,
    documentId: documentPackage.documentId,
    at: finishedAt,
  });
  console.info("[batch-ingest] file:done", {
    fileName: blob.name,
    documentId: documentPackage.documentId,
  });

  return {
    fileName: blob.name,
    documentId: documentPackage.documentId,
    documentPackage,
    transcription,
    metadata: documentMetadata,
    errors,
  };
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
      message: failures
        .map((failure) => `${failure.fileName}: ${failure.message}`)
        .join("; ") || "Batch failed with no successful files.",
      completedFiles: results.length,
      failedFiles: failures.length,
      result: aggregated,
    });
  }
}

async function cleanupBlobsStep(urls: string[]): Promise<void> {
  "use step";
  if (urls.length === 0) return;
  console.info("[batch-ingest] cleanup", { urls: urls.length });
  await Promise.allSettled(urls.map((url) => del(url)));
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
