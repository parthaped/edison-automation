import { put } from "@vercel/blob";
import {
  FatalError,
  RetryableError,
  getWritable,
} from "workflow";
import { assignDocumentId, normalizeFolderId } from "../id-policy";
import type { BatchEvent } from "../ingest-job-store";
import { rasterizePdfPages } from "../rasterize-pdf";
import { processSourceFile, mergeTranscribedMetadata, resolvePersistedDocumentStatus } from "../service";
import type {
  ManualIngestResult,
  PageImageUrl,
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

  // Assign every document ID up front in a single durable step. Doing this
  // before the concurrent chunks run guarantees collision-free identifiers even
  // when two files in the same chunk resolve to the same embedded ID (the
  // per-file persist steps run concurrently and would otherwise each read the
  // store before any of them has written).
  const documentIds = await assignIdsStep({
    folderId: input.folderId,
    fileNames: input.blobs.map((blob) => blob.name),
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
          documentId: documentIds[chunkStart + offset],
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
  documentId: string;
  aiEnabled: boolean;
}

async function processOneFile(input: ProcessOneFileInput): Promise<FileResult> {
  const { folderId, blob, promptTask, batchIndex, documentId, aiEnabled } =
    input;

  const transcribed = await transcribeFileStep({ blob, promptTask, aiEnabled });

  // Rasterize in its own step so it gets its own 60s budget separate from the
  // OCR call. PDFs become per-page JPGs in Blob; image uploads pass through.
  const pageImageUrls = await rasterizeFileStep({ blob, documentId });

  const persisted = await persistFileStep({
    folderId,
    blob,
    batchIndex,
    documentId,
    ocrText: transcribed.ocrText,
    model: transcribed.model,
    inputTokens: transcribed.inputTokens,
    outputTokens: transcribed.outputTokens,
    metadata: transcribed.metadata,
    pageImageUrls,
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

// Reads the existing document IDs once and assigns a collision-free identifier
// to every incoming file, accumulating assignments so two files in the same
// batch that embed the same ID get distinct identifiers. Runs as a single
// durable step before any concurrent processing.
async function assignIdsStep(input: {
  folderId?: string;
  fileNames: string[];
}): Promise<string[]> {
  "use step";

  const existingIds = new Set(
    await getEdisonService().getRepository().listDocumentIds(),
  );
  const folderId = input.folderId
    ? normalizeFolderId(input.folderId)
    : "UNASSIGNED-F";

  return input.fileNames.map((fileName, index) => {
    const assigned = assignDocumentId({
      folderId,
      sourceName: fileName,
      batchIndex: index + 1,
      existingIds,
    });
    existingIds.add(assigned.documentId);
    return assigned.documentId;
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

interface RasterizeFileStepInput {
  blob: BlobRef;
  documentId: string;
}

// Step 1.5: render each PDF page to a JPG and upload it to Blob, returning a
// per-page URL list the persist step then attaches to the document. Image
// uploads short-circuit to a single entry pointing at the original blob URL,
// so the viewer renders them through the same `<img>` path as PDF pages.
//
// Failures are intentionally non-fatal: we emit a stage event and return an
// empty list. The document still persists, just with the FacsimileSheet
// placeholder in the viewer (matching the pre-rasterizer behavior). This keeps
// a single bad PDF from poisoning a whole batch.
async function rasterizeFileStep(
  input: RasterizeFileStepInput,
): Promise<PageImageUrl[]> {
  "use step";

  const { blob, documentId } = input;
  const contentType = blob.contentType.toLowerCase();

  if (contentType !== "application/pdf") {
    if (contentType.startsWith("image/")) {
      return [{ pageIndex: 0, url: blob.url }];
    }
    return [];
  }

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "rasterizing",
    at: new Date().toISOString(),
  });

  try {
    const bytes = await fetchBlobBytes(blob);
    const pages = await rasterizePdfPages(bytes);
    const uploaded: PageImageUrl[] = [];
    for (const page of pages) {
      const pageNumber = page.pageIndex + 1;
      const padded = String(pageNumber).padStart(4, "0");
      // Vercel Blob's PutBody type rejects raw Uint8Array but accepts Buffer.
      // Wrapping the rasterized JPG in Buffer.from is a no-copy adapter on
      // Node runtimes.
      const result = await put(
        `page-images/${encodeURIComponent(documentId)}/${padded}.jpg`,
        Buffer.from(page.jpg.buffer, page.jpg.byteOffset, page.jpg.byteLength),
        {
          access: "public",
          contentType: "image/jpeg",
          addRandomSuffix: true,
        },
      );
      uploaded.push({
        pageIndex: page.pageIndex,
        url: result.url,
        width: page.width,
        height: page.height,
      });
    }
    return uploaded;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[batch-ingest] rasterize:failed", {
      fileName: blob.name,
      message,
    });
    return [];
  }
}

interface PersistFileStepInput {
  folderId?: string;
  blob: BlobRef;
  batchIndex: number;
  documentId: string;
  ocrText?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  metadata?: TranscribedMetadata;
  pageImageUrls: PageImageUrl[];
}

interface PersistFileStepResult {
  documentPackage: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
}

// Step 2: extract pages, merge the folded metadata, and persist the document
// (no AI call). Per-page image URLs from the rasterize step are attached so
// the viewer can render the original alongside the transcription.
async function persistFileStep(
  input: PersistFileStepInput,
): Promise<PersistFileStepResult> {
  "use step";

  const { folderId, blob, batchIndex, documentId, ocrText, model } = input;

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

  // The document ID was already assigned collision-free in assignIdsStep, so we
  // preserve it as-is and pass an empty existing-ID set (no per-file store scan).
  const processed = await processSourceFile({
    sourceFile,
    bytes,
    folderId,
    batchIndex,
    existingIds: new Set(),
    providedDocumentId: documentId,
    rawOcrText: ocrText,
    model,
    pageImageUrls: input.pageImageUrls,
  });

  const transcription: TranscriptionRun = {
    ...processed.transcription,
    inputTokens: input.inputTokens ?? processed.transcription.inputTokens,
    outputTokens: input.outputTokens ?? processed.transcription.outputTokens,
  };
  const documentPackage: DocumentPackage = resolvePersistedDocumentStatus(
    processed.documentPackage,
  );

  const metadata: MetadataExtraction = mergeTranscribedMetadata(
    processed.metadata,
    input.metadata,
  );

  await getEdisonService()
    .getRepository()
    .saveProcessedDocument(documentPackage, transcription, metadata);

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
