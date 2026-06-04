import { put, del } from "@vercel/blob";
import {
  FatalError,
  RetryableError,
  getWritable,
  fetch,
  sleep,
} from "workflow";
import { createExtractionPlan, type ExtractionPlan } from "../extraction";
import {
  assignDocumentId,
  defaultFolderIdFromFileName,
  normalizeFolderId,
} from "../id-policy";
import { isTransientError } from "../ai-request";
import {
  isTranscriptionEnabled,
  shouldUseGatewayForMetadata,
} from "../ocr-provider";
import {
  effectiveFileConcurrency,
  getPageChunkBatchDelayMs,
  getPageChunkConcurrency,
  getPageChunkSize,
  partitionPageRanges,
  shouldUsePageChunkedTranscription,
  type PageRange,
} from "../ingest-policy";
import { StageTimer, type FileStageTimingMs } from "../ingest-timing";
import type { BatchEvent } from "../ingest-job-store";
import {
  analyzeChunkedDocumentStructure,
  mergePageChunkResults,
  type ChunkedSubDocumentPlan,
  transcribePageChunkResilient,
  type PageImageRef,
  type TranscribePageChunkResult,
} from "../page-chunk-transcribe";
import { rasterizePdfWithProvider } from "../rasterize-provider";
import {
  shouldDeleteSourceAfterRasterize,
  shouldDeleteSourceAfterTranscribe,
} from "../source-blob-lifecycle";
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

const BASE_MAX_CONCURRENCY = 3;

// ---------- workflow ----------

export async function batchIngestWorkflow(
  input: BatchIngestWorkflowInput,
): Promise<ManualIngestResult> {
  "use workflow";

  const aiEnabled = isTranscriptionEnabled();
  const maxConcurrency = effectiveFileConcurrency(
    input.blobs,
    BASE_MAX_CONCURRENCY,
  );

  await emitBatchStartedStep({
    folderId: input.folderId,
    files: input.blobs.map((blob) => ({ name: blob.name, size: blob.size })),
  });

  const documentIds = await assignIdsStep({
    folderId: input.folderId,
    fileNames: input.blobs.map((blob) => blob.name),
  });

  const results: FileResult[] = [];
  const failures: FileFailure[] = [];

  for (
    let chunkStart = 0;
    chunkStart < input.blobs.length;
    chunkStart += maxConcurrency
  ) {
    const chunk = input.blobs.slice(chunkStart, chunkStart + maxConcurrency);
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

  return aggregated;
}

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

  // Single fetch + rasterize (or image passthrough) before transcription.
  const prepared = await prepareAndRasterizeStep({ blob, documentId });

  if (shouldDeleteSourceAfterRasterize({ blob, prepared })) {
    await deleteSourceBlobStep({ blob, reason: "after-rasterize" });
  }

  const transcribed = await transcribePreparedFile({
    blob,
    documentId,
    promptTask,
    aiEnabled,
    pageImageUrls: prepared.urls,
    extractionPlan: prepared.extractionPlan,
  });

  if (shouldDeleteSourceAfterTranscribe({ blob, prepared })) {
    await deleteSourceBlobStep({ blob, reason: "after-transcribe" });
  }

  const persisted = await persistSubDocumentsStep({
    folderId,
    blob,
    batchIndex,
    documentId,
    subDocuments: transcribed.subDocuments,
    model: transcribed.model,
    inputTokens: transcribed.inputTokens,
    outputTokens: transcribed.outputTokens,
    pageImageUrls: prepared.urls,
    rasterizeError: prepared.error,
    extractionPlan: prepared.extractionPlan,
    stageTimingMs: {
      ...prepared.stageTimingMs,
      transcribeMs: transcribed.transcribeMs,
      transcribeChunkCount: transcribed.transcribeChunkCount,
      totalMs:
        prepared.stageTimingMs.fetchMs +
        prepared.stageTimingMs.rasterizeMs +
        transcribed.transcribeMs +
        0,
    },
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

interface PrepareAndRasterizeStepInput {
  blob: BlobRef;
  documentId: string;
}

interface PrepareAndRasterizeStepResult {
  urls: PageImageUrl[];
  extractionPlan: ExtractionPlan;
  error?: string;
  stageTimingMs: Pick<
    FileStageTimingMs,
    "fetchMs" | "rasterizeMs" | "rasterizeBackend"
  >;
}

async function prepareAndRasterizeStep(
  input: PrepareAndRasterizeStepInput,
): Promise<PrepareAndRasterizeStepResult> {
  "use step";

  const { blob, documentId } = input;
  const timer = new StageTimer();
  timer.mark("fetchStart");

  console.info("[batch-ingest] file:start", { fileName: blob.name });

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "fetching",
    at: new Date().toISOString(),
  });

  const contentType = blob.contentType.toLowerCase();
  const sourceFile: SourceFile = {
    id: crypto.randomUUID(),
    name: blob.name,
    size: blob.size,
    mimeType: blob.contentType,
  };

  if (contentType.startsWith("image/")) {
    const bytes = await fetchBlobBytes(blob);
    timer.mark("rasterizeStart");
    timer.mark("rasterizeEnd");
    const extractionPlan = await createExtractionPlan(sourceFile, bytes);
    return {
      urls: [{ pageIndex: 0, url: blob.url }],
      extractionPlan,
      stageTimingMs: {
        fetchMs: timer.elapsedSince("fetchStart"),
        rasterizeMs: 0,
        rasterizeBackend: undefined,
      },
    };
  }

  if (contentType !== "application/pdf") {
    timer.mark("rasterizeStart");
    timer.mark("rasterizeEnd");
    return {
      urls: [],
      extractionPlan: {
        kind: "pdf",
        pageCount: 0,
        warnings: [],
        blockedReason: "Unsupported file type.",
      },
      stageTimingMs: {
        fetchMs: timer.elapsedSince("fetchStart"),
        rasterizeMs: 0,
      },
    };
  }

  const bytes = await fetchBlobBytes(blob);
  const extractionPlan = await createExtractionPlan(sourceFile, bytes);

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "rasterizing",
    at: new Date().toISOString(),
  });

  timer.mark("rasterizeStart");

  try {
    const { pages, backend } = await rasterizePdfWithProvider(bytes);
    const uploaded: PageImageUrl[] = [];
    for (const page of pages) {
      const pageNumber = page.pageIndex + 1;
      const padded = String(pageNumber).padStart(4, "0");
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
    timer.mark("rasterizeEnd");
    const fetchMs = timer.segmentMs("fetchStart", "rasterizeStart");
    const rasterizeMs = timer.segmentMs("rasterizeStart", "rasterizeEnd");
    const expectedPages = Math.max(1, extractionPlan.pageCount);
    if (uploaded.length !== expectedPages) {
      console.warn("[batch-ingest] rasterize:page-count-mismatch", {
        fileName: blob.name,
        uploaded: uploaded.length,
        expected: expectedPages,
      });
    }
    console.info("[batch-ingest] rasterize:done", {
      fileName: blob.name,
      pages: uploaded.length,
      backend,
      fetchMs,
      rasterizeMs,
    });
    return {
      urls: uploaded,
      extractionPlan,
      stageTimingMs: {
        fetchMs,
        rasterizeMs,
        rasterizeBackend: backend,
      },
    };
  } catch (error) {
    timer.mark("rasterizeEnd");
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
    return {
      urls: [],
      extractionPlan,
      error: summary,
      stageTimingMs: {
        fetchMs: timer.segmentMs("fetchStart", "rasterizeStart"),
        rasterizeMs: timer.segmentMs("rasterizeStart", "rasterizeEnd"),
      },
    };
  }
}

async function deleteSourceBlobStep(input: {
  blob: BlobRef;
  reason: "after-rasterize" | "after-transcribe";
}): Promise<void> {
  "use step";

  try {
    await del(input.blob.url);
    console.info("[batch-ingest] source-blob:deleted", {
      fileName: input.blob.name,
      reason: input.reason,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[batch-ingest] source-blob:delete-failed", {
      fileName: input.blob.name,
      reason: input.reason,
      message,
    });
  }
}

interface TranscribePreparedFileInput {
  blob: BlobRef;
  documentId: string;
  promptTask: "diplomatic-transcription" | "project-notebook";
  aiEnabled: boolean;
  pageImageUrls: PageImageUrl[];
  extractionPlan: ExtractionPlan;
}

interface TranscribeFileStepResult {
  subDocuments: TranscribedSubDocument[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  errors: TranscriptionError[];
  transcribeMs: number;
  transcribeChunkCount?: number;
}

async function transcribePreparedFile(
  input: TranscribePreparedFileInput,
): Promise<TranscribeFileStepResult> {
  const transcribeStarted = Date.now();
  const { blob, documentId, promptTask, aiEnabled, pageImageUrls, extractionPlan } =
    input;
  const errors: TranscriptionError[] = [];

  if (!aiEnabled || !isTranscribableMediaType(blob.contentType)) {
    return {
      subDocuments: [],
      errors,
      transcribeMs: Date.now() - transcribeStarted,
    };
  }

  const pageCount = Math.max(1, extractionPlan.pageCount);
  const useChunked = shouldUsePageChunkedTranscription({
    mimeType: blob.contentType,
    fileSizeBytes: blob.size,
    pageCount,
  });

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "transcribing",
    at: new Date().toISOString(),
  });

  try {
    if (useChunked && pageImageUrls.length > 0) {
      if (pageImageUrls.length !== pageCount) {
        throw new RetryableError(
          `Rasterized ${pageImageUrls.length} of ${pageCount} pages for ${blob.name}.`,
        );
      }

      const chunkSize = getPageChunkSize();
      const ranges = partitionPageRanges(pageCount, chunkSize);
      const urlByPage = new Map<number, string>();
      for (const entry of pageImageUrls) {
        urlByPage.set(entry.pageIndex + 1, entry.url);
      }

      const chunkConcurrency = getPageChunkConcurrency();
      const batchDelayMs = getPageChunkBatchDelayMs();
      const chunkResults: TranscribePageChunkResult[] = [];
      const failedRanges: string[] = [];
      for (
        let offset = 0;
        offset < ranges.length;
        offset += chunkConcurrency
      ) {
        if (offset > 0 && batchDelayMs > 0) {
          await sleep(batchDelayMs);
        }
        const batch = ranges.slice(offset, offset + chunkConcurrency);
        const settled = await Promise.allSettled(
          batch.map((range) =>
            transcribePageChunkStep({
              fileName: blob.name,
              documentId,
              promptTask,
              pages: pagesForRange(range, urlByPage),
            }),
          ),
        );
        for (const [index, outcome] of settled.entries()) {
          if (outcome.status === "fulfilled") {
            chunkResults.push(outcome.value);
          } else {
            const range = batch[index];
            const message =
              outcome.reason instanceof Error
                ? outcome.reason.message
                : String(outcome.reason);
            errors.push({
              fileName: blob.name,
              stage: "transcription",
              message: `Pages ${range.startPage}-${range.endPage} failed: ${message}`,
            });
            failedRanges.push(`${range.startPage}-${range.endPage}`);
          }
        }
      }

      if (failedRanges.length > 0) {
        throw new RetryableError(
          formatIncompleteChunkTranscriptionMessage(
            blob.name,
            failedRanges,
            errors,
          ),
        );
      }

      if (chunkResults.length === 0) {
        return {
          subDocuments: [],
          errors,
          transcribeMs: Date.now() - transcribeStarted,
          transcribeChunkCount: ranges.length,
        };
      }

      const missingPages = findMissingTranscribedPages(chunkResults, pageCount);
      if (missingPages.length > 0) {
        throw new RetryableError(
          `Page chunk transcription incomplete for ${blob.name}; missing pages: ${missingPages.join(", ")}.`,
        );
      }

      const orderedPages = chunkResults
        .flatMap((chunk) => chunk.pages)
        .sort((a, b) => a.pageNumber - b.pageNumber);
      const subDocumentPlans = shouldUseGatewayForMetadata()
        ? await analyzeChunkedDocumentStructureStep({
            fileName: blob.name,
            promptTask,
            pages: orderedPages,
            totalPages: pageCount,
          })
        : [];

      const merged = mergePageChunkResults(
        chunkResults,
        pageCount,
        emptyTranscribedMetadata(),
        subDocumentPlans,
      );
      assertEverySubDocumentHasTranscription(blob.name, merged.subDocuments);

      const transcribeMs = Date.now() - transcribeStarted;
      console.info("[batch-ingest] transcribe:chunked", {
        fileName: blob.name,
        chunks: ranges.length,
        transcribeMs,
      });

      return {
        subDocuments: merged.subDocuments,
        model: merged.model,
        inputTokens: merged.inputTokens,
        outputTokens: merged.outputTokens,
        errors,
        transcribeMs,
        transcribeChunkCount: ranges.length,
      };
    }

    const result = await transcribeWholeFileStep({
      blob,
      documentId,
      promptTask,
    });
    assertEverySubDocumentHasTranscription(blob.name, result.subDocuments);

    return {
      ...result,
      transcribeMs: Date.now() - transcribeStarted,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push({ fileName: blob.name, stage: "transcription", message });
    if (error instanceof RetryableError) {
      throw error;
    }
    if (isTransientError(error)) {
      throw new RetryableError(
        `Transcription failed for ${blob.name}: ${message}`,
      );
    }
    return {
      subDocuments: [],
      errors,
      transcribeMs: Date.now() - transcribeStarted,
    };
  }
}

async function transcribeWholeFileStep(input: {
  blob: BlobRef;
  documentId: string;
  promptTask: "diplomatic-transcription" | "project-notebook";
}): Promise<Omit<TranscribeFileStepResult, "transcribeMs">> {
  "use step";

  const bytes = await fetchBlobBytes(input.blob);
  const transcribed = await transcribeDocument({
    bytes,
    mediaType: input.blob.contentType,
    promptTask: input.promptTask,
    documentId: input.documentId,
  });
  return {
    subDocuments: transcribed.subDocuments,
    model: transcribed.model,
    inputTokens: transcribed.inputTokens,
    outputTokens: transcribed.outputTokens,
    errors: [],
  };
}

async function transcribePageChunkStep(input: {
  fileName: string;
  documentId: string;
  promptTask: "diplomatic-transcription" | "project-notebook";
  pages: PageImageRef[];
}): Promise<TranscribePageChunkResult> {
  "use step";

  if (input.pages.length === 0) {
    throw new RetryableError(
      `Page chunk transcription for ${input.fileName} has no rasterized pages.`,
    );
  }

  try {
    return await transcribePageChunkResilient({
      pages: input.pages,
      documentId: input.documentId,
      promptTask: input.promptTask,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isTransientError(error)) {
      throw new RetryableError(
        `Page chunk transcription failed for ${input.fileName}: ${message}`,
      );
    }
    throw error;
  }
}

async function analyzeChunkedDocumentStructureStep(input: {
  fileName: string;
  promptTask: "diplomatic-transcription" | "project-notebook";
  pages: Array<{ pageNumber: number; text: string }>;
  totalPages: number;
}): Promise<ChunkedSubDocumentPlan[]> {
  "use step";

  try {
    return await analyzeChunkedDocumentStructure({
      promptTask: input.promptTask,
      pages: input.pages,
      totalPages: input.totalPages,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[batch-ingest] chunked-split:failed", {
      fileName: input.fileName,
      message,
    });
    return [];
  }
}

interface PersistSubDocumentsStepInput {
  folderId?: string;
  blob: BlobRef;
  batchIndex: number;
  documentId: string;
  subDocuments: TranscribedSubDocument[];
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  pageImageUrls: PageImageUrl[];
  rasterizeError?: string;
  extractionPlan: ExtractionPlan;
  stageTimingMs: Pick<
    FileStageTimingMs,
    "fetchMs" | "rasterizeMs" | "rasterizeBackend"
  > & {
    transcribeMs: number;
    transcribeChunkCount?: number;
    totalMs: number;
  };
}

interface PersistSubDocumentsStepResult {
  documentPackages: DocumentPackage[];
  transcriptions: TranscriptionRun[];
  metadata: MetadataExtraction[];
}

async function persistSubDocumentsStep(
  input: PersistSubDocumentsStepInput,
): Promise<PersistSubDocumentsStepResult> {
  "use step";

  const { folderId, blob, batchIndex, documentId } = input;
  const timer = new StageTimer();
  timer.mark("persistStart");

  await emitEvent({
    type: "file-stage",
    fileName: blob.name,
    stage: "saving",
    at: new Date().toISOString(),
  });

  const sourceFile: SourceFile = {
    id: crypto.randomUUID(),
    name: blob.name,
    size: blob.size,
    mimeType: blob.contentType,
  };

  const processed = await processSourceFileSubDocuments({
    sourceFile,
    bytes: new Uint8Array(0),
    extractionPlan: input.extractionPlan,
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

  const service = getEdisonService();
  const repository = service.getRepository();
  const auditLog = service.getAuditLog();
  for (const sibling of processed.siblings) {
    await repository.saveProcessedDocument(
      sibling.documentPackage,
      sibling.transcription,
      sibling.metadata,
    );
    const now = new Date().toISOString();
    await auditLog.append({
      type: "file_ingested",
      timestamp: now,
      documentId: sibling.documentPackage.documentId,
      folderId: sibling.documentPackage.folderId,
      title: sibling.documentPackage.title,
      detail: `${sibling.documentPackage.pages.length} page(s) from ${blob.name}`,
      metadata: {
        sourceFile: blob.name,
        pageCount: sibling.documentPackage.pages.length,
        groupId: sibling.documentPackage.sourceGroup?.groupId,
      },
    });
    await auditLog.append({
      type: "file_transcribed",
      timestamp: now,
      documentId: sibling.documentPackage.documentId,
      folderId: sibling.documentPackage.folderId,
      title: sibling.documentPackage.title,
      detail: `${input.model ?? "gateway-configured-model"} · prompt v${sibling.transcription.promptVersion}`,
      metadata: {
        model: input.model,
        promptVersion: sibling.transcription.promptVersion,
        inputTokens: sibling.transcription.inputTokens,
        outputTokens: sibling.transcription.outputTokens,
        costUsd: sibling.transcription.costUsd,
      },
    });
    await auditLog.append({
      type: "file_graded",
      timestamp: now,
      documentId: sibling.documentPackage.documentId,
      folderId: sibling.documentPackage.folderId,
      title: sibling.documentPackage.title,
      confidence: sibling.documentPackage.confidence,
      status: sibling.documentPackage.status,
      detail: `Graded ${sibling.documentPackage.confidence}`,
      metadata: {
        confidence: sibling.documentPackage.confidence,
        uncertainReadings: sibling.transcription.uncertainReadings.length,
      },
    });
  }

  timer.mark("persistEnd");
  const persistMs = timer.segmentMs("persistStart", "persistEnd");
  const stageTimingMs: FileStageTimingMs = {
    fetchMs: input.stageTimingMs.fetchMs,
    rasterizeMs: input.stageTimingMs.rasterizeMs,
    transcribeMs: input.stageTimingMs.transcribeMs,
    persistMs,
    totalMs:
      input.stageTimingMs.fetchMs +
      input.stageTimingMs.rasterizeMs +
      input.stageTimingMs.transcribeMs +
      persistMs,
    transcribeChunkCount: input.stageTimingMs.transcribeChunkCount,
    rasterizeBackend: input.stageTimingMs.rasterizeBackend,
  };

  const primary = processed.siblings[0]?.documentPackage;
  await emitEvent({
    type: "file-completed",
    fileName: blob.name,
    documentId: primary?.documentId ?? documentId,
    at: new Date().toISOString(),
    stageTimingMs,
  });
  console.info("[batch-ingest] file:done", {
    fileName: blob.name,
    documentId: primary?.documentId ?? documentId,
    siblings: processed.siblings.length,
    stageTimingMs,
  });

  return {
    documentPackages: processed.siblings.map((s) => s.documentPackage),
    transcriptions: processed.siblings.map((s) => s.transcription),
    metadata: processed.siblings.map((s) => s.metadata),
  };
}

async function emitBatchStartedStep(input: {
  folderId?: string;
  files: Array<{ name: string; size?: number }>;
}): Promise<void> {
  "use step";
  console.info("[batch-ingest] started", {
    totalFiles: input.files.length,
    folderId: input.folderId,
  });
  const startedAt = new Date().toISOString();
  await emitEvent({
    type: "batch-started",
    folderId: input.folderId,
    files: input.files,
    startedAt,
  });
  await getEdisonService().getAuditLog().append({
    type: "ingest_started",
    timestamp: startedAt,
    folderId: input.folderId
      ? normalizeFolderId(input.folderId)
      : undefined,
    detail: `${input.files.length} file(s) queued`,
    metadata: {
      totalFiles: input.files.length,
      folderId: input.folderId,
      fileNames: input.files.map((file) => file.name),
    },
  });
}

async function assignIdsStep(input: {
  folderId?: string;
  fileNames: string[];
}): Promise<string[]> {
  "use step";

  const existingIds = new Set(
    await getEdisonService().getRepository().listDocumentIds(),
  );
  const normalizedBatchFolder = input.folderId
    ? normalizeFolderId(input.folderId)
    : undefined;

  return input.fileNames.map((fileName, index) => {
    // When the operator left the folder blank, each file's filename stem
    // becomes its folder (`E2002.pdf` -> `E2002`). When they supplied a
    // single folder, every file shares it and the next-available-position
    // logic disambiguates the doc ids.
    const folderId = normalizedBatchFolder ?? defaultFolderIdFromFileName(fileName);
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

function buildResult(results: FileResult[]): ManualIngestResult {
  return {
    packages: results.flatMap((entry) => entry.documentPackages),
    transcriptions: results.flatMap((entry) => entry.transcriptions),
    metadata: results.flatMap((entry) => entry.metadata),
    transcriptionErrors: results.flatMap((entry) => entry.errors),
  };
}

function pagesForRange(
  range: PageRange,
  urlByPage: Map<number, string>,
): PageImageRef[] {
  const pages: PageImageRef[] = [];
  const missing: number[] = [];
  for (let pageNumber = range.startPage; pageNumber <= range.endPage; pageNumber++) {
    const url = urlByPage.get(pageNumber);
    if (!url) {
      missing.push(pageNumber);
      continue;
    }
    pages.push({ pageNumber, url });
  }
  if (missing.length > 0) {
    throw new RetryableError(
      `Missing rasterized page images for pages ${missing.join(", ")}.`,
    );
  }
  return pages;
}

function formatIncompleteChunkTranscriptionMessage(
  fileName: string,
  failedRanges: string[],
  errors: TranscriptionError[],
): string {
  const causes = errors
    .filter((entry) => entry.stage === "transcription")
    .slice(0, 2)
    .map((entry) => entry.message);
  const causeSuffix =
    causes.length > 0 ? ` Causes: ${causes.join("; ")}` : "";
  return `Page chunk transcription incomplete for ${fileName}; failed page ranges: ${failedRanges.join(", ")}.${causeSuffix}`;
}

function findMissingTranscribedPages(
  chunkResults: TranscribePageChunkResult[],
  totalPages: number,
): number[] {
  const seen = new Set<number>();
  for (const chunk of chunkResults) {
    for (const page of chunk.pages) {
      seen.add(page.pageNumber);
    }
  }
  return Array.from({ length: totalPages }, (_, index) => index + 1).filter(
    (pageNumber) => !seen.has(pageNumber),
  );
}

function assertEverySubDocumentHasTranscription(
  fileName: string,
  subDocuments: TranscribedSubDocument[],
): void {
  const emptyRanges = subDocuments
    .filter((subDocument) => subDocument.ocrText.trim().length === 0)
    .map((subDocument) => `${subDocument.startPage}-${subDocument.endPage}`);
  if (emptyRanges.length > 0) {
    throw new RetryableError(
      `Transcription incomplete for ${fileName}; empty sub-document ranges: ${emptyRanges.join(", ")}.`,
    );
  }
}

function emptyTranscribedMetadata(): TranscribedSubDocument["metadata"] {
  return {
    title: "",
    documentType: "",
    date: "",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
    places: [],
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

async function emitEvent(event: BatchEvent): Promise<void> {
  "use step";

  const writer = getWritable<BatchEvent>().getWriter();
  try {
    await writer.write(event);
  } finally {
    writer.releaseLock();
  }
}
