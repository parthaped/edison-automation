import { del } from "@vercel/blob";
import { AppError } from "./app-error";
import { getEdisonService } from "./service-factory";
import type { ManualIngestResult, UploadFileLike } from "./service";

export interface BlobIngestRef {
  url: string;
  name: string;
  size: number;
  contentType: string;
}

export type ManualIngestJobStatus =
  | "queued"
  | "fetching"
  | "processing"
  | "completed"
  | "failed";

export type ManualIngestJobStage =
  | "queued"
  | "fetching-blobs"
  | "transcribing"
  | "extracting"
  | "metadata"
  | "saving"
  | "cleanup"
  | "completed"
  | "failed";

export interface ManualIngestJobSnapshot {
  batchId: string;
  status: ManualIngestJobStatus;
  stage: ManualIngestJobStage;
  folderId?: string;
  totalFiles: number;
  processedFiles: number;
  currentFileName?: string;
  createdAt: string;
  updatedAt: string;
  result?: ManualIngestResult;
  error?: string;
}

interface CreateBlobJobInput {
  kind: "blob";
  blobs: BlobIngestRef[];
  folderId?: string;
}

interface CreateFileJobInput {
  kind: "files";
  files: UploadFileLike[];
  folderId?: string;
}

type CreateManualIngestJobInput = CreateBlobJobInput | CreateFileJobInput;

const jobs = new Map<string, ManualIngestJobSnapshot>();

export function createManualIngestJob(
  input: CreateManualIngestJobInput,
): ManualIngestJobSnapshot {
  const now = new Date().toISOString();
  const batchId = `manual-${crypto.randomUUID()}`;
  const totalFiles = input.kind === "blob" ? input.blobs.length : input.files.length;
  const snapshot: ManualIngestJobSnapshot = {
    batchId,
    status: "queued",
    stage: "queued",
    folderId: input.folderId,
    totalFiles,
    processedFiles: 0,
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(batchId, snapshot);
  void processManualIngestJob(batchId, input);
  return snapshot;
}

export function getManualIngestJob(batchId: string): ManualIngestJobSnapshot {
  const job = jobs.get(batchId);
  if (!job) {
    throw new AppError("NOT_FOUND", "Manual ingest batch was not found.", 404);
  }
  return job;
}

function updateManualIngestJob(
  batchId: string,
  update: Partial<Omit<ManualIngestJobSnapshot, "batchId" | "createdAt">>,
) {
  const current = getManualIngestJob(batchId);
  jobs.set(batchId, {
    ...current,
    ...update,
    updatedAt: new Date().toISOString(),
  });
}

async function processManualIngestJob(
  batchId: string,
  input: CreateManualIngestJobInput,
) {
  const startedAt = Date.now();
  const blobUrlsToDelete = input.kind === "blob" ? input.blobs.map((blob) => blob.url) : [];

  try {
    const files =
      input.kind === "blob"
        ? await fetchBlobFiles(batchId, input.blobs)
        : input.files;

    updateManualIngestJob(batchId, {
      status: "processing",
      stage: "transcribing",
      processedFiles: 0,
    });
    logIngestStage(batchId, "processing-start", startedAt, {
      fileCount: files.length,
    });

    const result = await getEdisonService().ingestManualFiles({
      files,
      folderId: input.folderId,
      onProgress: (progress) => {
        updateManualIngestJob(batchId, {
          status: "processing",
          stage: progress.stage,
          processedFiles: progress.processedFiles,
          currentFileName: progress.fileName,
        });
      },
    });

    updateManualIngestJob(batchId, {
      status: "completed",
      stage: "completed",
      processedFiles: files.length,
      currentFileName: undefined,
      result,
    });
    logIngestStage(batchId, "completed", startedAt, {
      fileCount: files.length,
      warningCount: result.transcriptionErrors.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateManualIngestJob(batchId, {
      status: "failed",
      stage: "failed",
      error: message,
    });
    logIngestStage(batchId, "failed", startedAt, { error: message });
  } finally {
    if (blobUrlsToDelete.length > 0) {
      updateManualIngestJob(batchId, { stage: "cleanup" });
      const cleanupStart = Date.now();
      await Promise.allSettled(blobUrlsToDelete.map((url) => del(url)));
      logIngestStage(batchId, "cleanup", cleanupStart, {
        blobCount: blobUrlsToDelete.length,
      });
      const job = getManualIngestJob(batchId);
      if (job.status === "completed") {
        updateManualIngestJob(batchId, { stage: "completed" });
      }
    }
  }
}

async function fetchBlobFiles(
  batchId: string,
  blobs: BlobIngestRef[],
): Promise<UploadFileLike[]> {
  updateManualIngestJob(batchId, {
    status: "fetching",
    stage: "fetching-blobs",
  });
  const startedAt = Date.now();
  const files = await Promise.all(
    blobs.map(async (blob, index) => {
      updateManualIngestJob(batchId, {
        processedFiles: index,
        currentFileName: blob.name,
      });
      const response = await fetch(blob.url);
      if (!response.ok) {
        throw new Error(
          `Failed to fetch blob ${blob.name} from temporary storage: ${response.status}`,
        );
      }
      const arrayBuffer = await response.arrayBuffer();
      return {
        name: blob.name,
        size: blob.size || arrayBuffer.byteLength,
        type: blob.contentType,
        arrayBuffer: async () => arrayBuffer,
      } satisfies UploadFileLike;
    }),
  );
  logIngestStage(batchId, "fetching-blobs", startedAt, {
    fileCount: blobs.length,
  });
  return files;
}

function logIngestStage(
  batchId: string,
  stage: string,
  startedAt: number,
  details?: Record<string, unknown>,
) {
  console.info("[manual-ingest]", {
    batchId,
    stage,
    elapsedMs: Date.now() - startedAt,
    ...details,
  });
}

