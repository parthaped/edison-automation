import { del } from "@vercel/blob";
import {
  FatalError,
  RetryableError,
  getWritable,
} from "workflow";
import {
  getIngestJobStore,
  setFileStage,
  type FileStage,
  type IngestJobSnapshot,
} from "../ingest-job-store";
import { processSourceFile } from "../service";
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
  batchId: string;
  folderId?: string;
  blobs: BlobRef[];
  promptTask?: "diplomatic-transcription" | "project-notebook";
}

export interface FileResult {
  fileName: string;
  documentId: string;
  documentPackage: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
  errors: Array<{ stage: "transcription" | "metadata"; message: string }>;
}

export interface FileFailure {
  fileName: string;
  message: string;
}

interface BatchEvent {
  type: "stage" | "file-completed" | "file-failed" | "batch-completed" | "batch-failed";
  batchId: string;
  fileName?: string;
  stage?: FileStage;
  message?: string;
  documentId?: string;
  totalFiles?: number;
  completedFiles?: number;
  failedFiles?: number;
}

const MAX_CONCURRENCY = 3;

// ---------- workflow ----------

export async function batchIngestWorkflow(
  input: BatchIngestWorkflowInput,
): Promise<{ batchId: string; completedFiles: number; failedFiles: number }> {
  "use workflow";

  await markBatchStartedStep(input.batchId);

  const results: FileResult[] = [];
  const failures: FileFailure[] = [];

  // Fan out with a concurrency cap. Workflow steps run sequentially within the
  // workflow function but each batch chunk runs in parallel via Promise.all.
  for (let chunkStart = 0; chunkStart < input.blobs.length; chunkStart += MAX_CONCURRENCY) {
    const chunk = input.blobs.slice(chunkStart, chunkStart + MAX_CONCURRENCY);
    const settled = await Promise.allSettled(
      chunk.map((blob) =>
        processFileStep({
          batchId: input.batchId,
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
        await recordFileFailureStep(input.batchId, blob.name, message);
      }
    }
  }

  await finalizeBatchStep(input.batchId, results, failures);
  await cleanupBlobsStep(input.batchId, input.blobs.map((blob) => blob.url));

  return {
    batchId: input.batchId,
    completedFiles: results.length,
    failedFiles: failures.length,
  };
}

// ---------- steps ----------

async function markBatchStartedStep(batchId: string): Promise<void> {
  "use step";
  console.info("[batch-ingest] started", { batchId });
  await getIngestJobStore().patch(batchId, (current) => ({
    ...current,
    status: "running",
  }));
  await emitEvent({ type: "stage", batchId, stage: "fetching" });
}

interface ProcessFileStepInput {
  batchId: string;
  folderId?: string;
  blob: BlobRef;
  promptTask: "diplomatic-transcription" | "project-notebook";
}

async function processFileStep(
  input: ProcessFileStepInput,
): Promise<FileResult> {
  "use step";

  const { batchId, folderId, blob, promptTask } = input;
  console.info("[batch-ingest] file:start", { batchId, fileName: blob.name });

  await patchFileStage(batchId, blob.name, {
    stage: "fetching",
    startedAt: new Date().toISOString(),
  });

  const bytes = await fetchBlobBytes(blob);

  let rawOcrText: string | undefined;
  let transcribeModel: string | undefined;
  let transcribeInputTokens: number | undefined;
  let transcribeOutputTokens: number | undefined;
  const errors: FileResult["errors"] = [];

  if (
    process.env.AI_GATEWAY_API_KEY &&
    isTranscribableMediaType(blob.contentType)
  ) {
    await patchFileStage(batchId, blob.name, { stage: "transcribing" });
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
      errors.push({ stage: "transcription", message });
      // Transient network / rate limit errors should retry the whole step;
      // permanent validation errors should not.
      if (isTransientError(error)) {
        throw new RetryableError(`Transcription failed for ${blob.name}: ${message}`);
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
  if (process.env.AI_GATEWAY_API_KEY && rawOcrText && rawOcrText.trim().length > 0) {
    await patchFileStage(batchId, blob.name, { stage: "indexing" });
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
      errors.push({ stage: "metadata", message });
      if (isTransientError(error)) {
        throw new RetryableError(`Metadata extraction failed for ${blob.name}: ${message}`);
      }
    }
  }

  const transcription: TranscriptionRun = {
    ...processed.transcription,
    inputTokens: transcribeInputTokens ?? processed.transcription.inputTokens,
    outputTokens: transcribeOutputTokens ?? processed.transcription.outputTokens,
  };
  const documentPackage: DocumentPackage =
    rawOcrText !== undefined && processed.documentPackage.status === "queued"
      ? { ...processed.documentPackage, status: "needs_review" }
      : processed.documentPackage;

  await patchFileStage(batchId, blob.name, { stage: "saving" });
  await repository.saveProcessedDocument(documentPackage, transcription, documentMetadata);

  await patchFileStage(batchId, blob.name, {
    stage: "done",
    finishedAt: new Date().toISOString(),
    documentId: documentPackage.documentId,
  });
  await emitEvent({
    type: "file-completed",
    batchId,
    fileName: blob.name,
    documentId: documentPackage.documentId,
  });
  console.info("[batch-ingest] file:done", {
    batchId,
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

async function recordFileFailureStep(
  batchId: string,
  fileName: string,
  message: string,
): Promise<void> {
  "use step";
  console.warn("[batch-ingest] file:failed", { batchId, fileName, message });
  await patchFileStage(batchId, fileName, {
    stage: "failed",
    errorMessage: message,
    finishedAt: new Date().toISOString(),
  });
  await emitEvent({
    type: "file-failed",
    batchId,
    fileName,
    message,
  });
}

async function finalizeBatchStep(
  batchId: string,
  results: FileResult[],
  failures: FileFailure[],
): Promise<void> {
  "use step";

  const status: IngestJobSnapshot["status"] =
    results.length > 0 ? "completed" : "failed";
  console.info("[batch-ingest] finalize", {
    batchId,
    completed: results.length,
    failed: failures.length,
    status,
  });

  await getIngestJobStore().patch(batchId, (current) => ({
    ...current,
    status,
    completedFiles: results.length,
    failedFiles: failures.length,
    result: {
      packages: results.map((entry) => entry.documentPackage),
      transcriptions: results.map((entry) => entry.transcription),
      metadata: results.map((entry) => entry.metadata),
      transcriptionErrors: results.flatMap((entry) =>
        entry.errors.map((error) => ({
          fileName: entry.fileName,
          stage: error.stage,
          message: error.message,
        })),
      ),
    },
    error:
      failures.length > 0 && results.length === 0
        ? failures.map((failure) => `${failure.fileName}: ${failure.message}`).join("; ")
        : current.error,
  }));

  await emitEvent({
    type: status === "completed" ? "batch-completed" : "batch-failed",
    batchId,
    completedFiles: results.length,
    failedFiles: failures.length,
  });
}

async function cleanupBlobsStep(
  batchId: string,
  urls: string[],
): Promise<void> {
  "use step";
  if (urls.length === 0) return;
  console.info("[batch-ingest] cleanup", { batchId, urls: urls.length });
  await Promise.allSettled(urls.map((url) => del(url)));
}

// ---------- helpers (also steps where needed) ----------

async function patchFileStage(
  batchId: string,
  fileName: string,
  partial: Partial<{
    stage: FileStage;
    startedAt: string;
    finishedAt: string;
    documentId: string;
    errorMessage: string;
  }>,
): Promise<void> {
  await getIngestJobStore().patch(batchId, (current) => ({
    ...current,
    perFile: setFileStage(current.perFile, fileName, partial),
  }));
  if (partial.stage) {
    await emitEvent({
      type: "stage",
      batchId,
      fileName,
      stage: partial.stage,
    });
  }
}

async function fetchBlobBytes(blob: BlobRef): Promise<Uint8Array> {
  const response = await fetch(blob.url);
  if (response.status === 404 || response.status === 410) {
    throw new FatalError(`Blob ${blob.name} no longer exists (${response.status}).`);
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
  try {
    const writer = getWritable<BatchEvent>().getWriter();
    try {
      await writer.write(event);
    } finally {
      writer.releaseLock();
    }
  } catch {
    // Writable not available in some test contexts; safe to ignore.
  }
}
