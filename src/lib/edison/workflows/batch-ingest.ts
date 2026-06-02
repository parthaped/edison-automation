import { put } from "@vercel/blob";
import {
  FatalError,
  RetryableError,
  getWritable,
} from "workflow";
import { assignDocumentId, normalizeFolderId } from "../id-policy";
import type { BatchEvent } from "../ingest-job-store";
import { rasterizePdfPages } from "../rasterize-pdf";
import {
  processSourceFileSubDocuments,
  type TranscribedSubDocument,
} from "../service";
import type {
  ManualIngestResult,
  PageImageUrl,
  TranscriptionError,
} from "../service";
import { getEdisonService } from "../service-factory";
import {
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
  // First sibling's document ID (or the lone document ID for single-doc files).
  // Used to surface a primary record in the per-file pipeline tracker.
  primaryDocumentId: string;
  documentPackages: DocumentPackage[];
  transcriptions: TranscriptionRun[];
  metadata: MetadataExtraction[];
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
  const rasterized = await rasterizeFileStep({ blob, documentId });

  const persisted = await persistSubDocumentsStep({
    folderId,
    blob,
    batchIndex,
    documentId,
    subDocuments: transcribed.subDocuments,
    model: transcribed.model,
    inputTokens: transcribed.inputTokens,
    outputTokens: transcribed.outputTokens,
    pageImageUrls: rasterized.urls,
    rasterizeError: rasterized.error,
  });

  return {
    fileName: blob.name,
    primaryDocumentId: persisted.documentPackages[0]?.documentId ?? documentId,
    documentPackages: persisted.documentPackages,
    transcriptions: persisted.transcriptions,
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
  // Sub-documents detected by the model. Always populated: AI-enabled paths
  // return what the model produced; AI-disabled or transcription-failure paths
  // return an empty array so the persist step still emits a single placeholder
  // sub-document covering every page.
  subDocuments: TranscribedSubDocument[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
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
        subDocuments: transcribed.subDocuments,
        model: transcribed.model,
        inputTokens: transcribed.inputTokens,
        outputTokens: transcribed.outputTokens,
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

  return { subDocuments: [], errors };
}

interface RasterizeFileStepInput {
  blob: BlobRef;
  documentId: string;
}

interface RasterizeFileStepResult {
  urls: PageImageUrl[];
  // Populated when PDF rasterization could not produce any page images. The
  // persist step copies this into `validationWarnings` and `PageImage.renderError`
  // so the reviewer sees *why* the source image is missing instead of an
  // empty frame.
  error?: string;
}

// Step 1.5: render each PDF page to a JPG and upload it to Blob, returning a
// per-page URL list the persist step then attaches to the document. Image
// uploads short-circuit to a single entry pointing at the original blob URL,
// so the viewer renders them through the same `<img>` path as PDF pages.
//
// Failures are non-fatal: we record the reason on the result so the persist
// step can attach it to the saved DocumentPackage, and we emit a `file-warning`
// event so the reviewer sees it in the upload tracker. This keeps a single
// bad PDF from poisoning a whole batch while making the failure visible
// instead of degrading silently into a blank placeholder.
async function rasterizeFileStep(
  input: RasterizeFileStepInput,
): Promise<RasterizeFileStepResult> {
  "use step";

  const { blob, documentId } = input;
  const contentType = blob.contentType.toLowerCase();

  if (contentType !== "application/pdf") {
    if (contentType.startsWith("image/")) {
      return { urls: [{ pageIndex: 0, url: blob.url }] };
    }
    return { urls: [] };
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
    return { urls: uploaded };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[batch-ingest] rasterize:failed", {
      fileName: blob.name,
      message,
    });
    const summary = `PDF rasterization failed: ${message}`;
    await emitEvent({
      type: "file-warning",
      fileName: blob.name,
      message: summary,
      at: new Date().toISOString(),
    });
    return { urls: [], error: summary };
  }
}

interface PersistSubDocumentsStepInput {
  folderId?: string;
  blob: BlobRef;
  batchIndex: number;
  // The pre-assigned base document id for the uploaded source. Position-0
  // sibling keeps this id; positions 1..N get suffixed.
  documentId: string;
  subDocuments: TranscribedSubDocument[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  pageImageUrls: PageImageUrl[];
  // Carried through from the rasterize step so every persisted sibling can
  // surface the failure reason via `validationWarnings` and per-page
  // `renderError`. Undefined when rasterization succeeded.
  rasterizeError?: string;
}

interface PersistSubDocumentsStepResult {
  documentPackages: DocumentPackage[];
  transcriptions: TranscriptionRun[];
  metadata: MetadataExtraction[];
}

// Step 2: extract pages, mint sibling ids for every detected sub-document,
// build per-sibling page subsets + transcriptions + metadata, and persist
// every record (no AI call). Single-document uploads collapse to one
// sibling so the surrounding flow stays uniform.
async function persistSubDocumentsStep(
  input: PersistSubDocumentsStepInput,
): Promise<PersistSubDocumentsStepResult> {
  "use step";

  const { folderId, blob, batchIndex, documentId } = input;

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

  const processed = await processSourceFileSubDocuments({
    sourceFile,
    bytes,
    folderId,
    batchIndex,
    existingIds: new Set(),
    providedDocumentId: documentId,
    subDocuments: input.subDocuments,
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    pageImageUrls: input.pageImageUrls,
    rasterizeError: input.rasterizeError,
  });

  const repository = getEdisonService().getRepository();
  for (const sibling of processed.siblings) {
    await repository.saveProcessedDocument(
      sibling.documentPackage,
      sibling.transcription,
      sibling.metadata,
    );
  }

  const primary = processed.siblings[0]?.documentPackage;
  await emitEvent({
    type: "file-completed",
    fileName: blob.name,
    documentId: primary?.documentId ?? documentId,
    at: new Date().toISOString(),
  });
  console.info("[batch-ingest] file:done", {
    fileName: blob.name,
    documentId: primary?.documentId ?? documentId,
    siblings: processed.siblings.length,
  });

  return {
    documentPackages: processed.siblings.map((s) => s.documentPackage),
    transcriptions: processed.siblings.map((s) => s.transcription),
    metadata: processed.siblings.map((s) => s.metadata),
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
    packages: results.flatMap((entry) => entry.documentPackages),
    transcriptions: results.flatMap((entry) => entry.transcriptions),
    metadata: results.flatMap((entry) => entry.metadata),
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
