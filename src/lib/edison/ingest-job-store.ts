import type { ManualIngestResult } from "./service";

export type FileStage =
  | "queued"
  | "uploaded"
  | "fetching"
  | "transcribing"
  | "indexing"
  | "saving"
  | "done"
  | "failed";

export type JobStatus = "queued" | "running" | "completed" | "failed";

export interface FileSnapshot {
  fileName: string;
  size?: number;
  stage: FileStage;
  startedAt?: string;
  finishedAt?: string;
  documentId?: string;
  errorMessage?: string;
}

export interface IngestJobSnapshot {
  batchId: string;
  status: JobStatus;
  folderId?: string;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  createdAt: string;
  updatedAt: string;
  perFile: FileSnapshot[];
  result?: ManualIngestResult;
  error?: string;
  runId?: string;
}

// ---------- Event log ----------
//
// The workflow runtime stores a durable event log per run (replicated Redis on
// Vercel). We use that log instead of a side-channel KV store so the workflow
// worker and the polling API route always agree on state without provisioning
// an extra integration.

export interface BatchStartedPayload {
  folderId?: string;
  files: Array<{ name: string; size?: number }>;
  startedAt: string;
}

export interface FileStagePayload {
  fileName: string;
  stage: FileStage;
  at: string;
}

export interface FileCompletedPayload {
  fileName: string;
  documentId: string;
  at: string;
}

export interface FileFailedPayload {
  fileName: string;
  message: string;
  at: string;
}

export interface BatchCompletedPayload {
  at: string;
  result: ManualIngestResult;
  completedFiles: number;
  failedFiles: number;
}

export interface BatchFailedPayload {
  at: string;
  message: string;
  completedFiles: number;
  failedFiles: number;
  result?: ManualIngestResult;
}

export type BatchEvent =
  | ({ type: "batch-started" } & BatchStartedPayload)
  | ({ type: "file-stage" } & FileStagePayload)
  | ({ type: "file-completed" } & FileCompletedPayload)
  | ({ type: "file-failed" } & FileFailedPayload)
  | ({ type: "batch-completed" } & BatchCompletedPayload)
  | ({ type: "batch-failed" } & BatchFailedPayload);

// ---------- Snapshot helpers ----------

export function emptySnapshot(batchId: string): IngestJobSnapshot {
  const now = new Date().toISOString();
  return {
    batchId,
    runId: batchId,
    status: "queued",
    totalFiles: 0,
    completedFiles: 0,
    failedFiles: 0,
    createdAt: now,
    updatedAt: now,
    perFile: [],
  };
}

export function initialSnapshot(
  batchId: string,
  options: {
    folderId?: string;
    files: Array<{ name: string; size?: number }>;
  },
): IngestJobSnapshot {
  const now = new Date().toISOString();
  return {
    batchId,
    runId: batchId,
    status: "queued",
    folderId: options.folderId,
    totalFiles: options.files.length,
    completedFiles: 0,
    failedFiles: 0,
    createdAt: now,
    updatedAt: now,
    perFile: options.files.map((file) => ({
      fileName: file.name,
      size: file.size,
      stage: "uploaded",
    })),
  };
}

export function applyBatchEvent(
  snapshot: IngestJobSnapshot,
  event: BatchEvent,
): IngestJobSnapshot {
  switch (event.type) {
    case "batch-started":
      return {
        ...snapshot,
        status: "running",
        folderId: event.folderId ?? snapshot.folderId,
        totalFiles: event.files.length,
        perFile:
          snapshot.perFile.length === event.files.length
            ? snapshot.perFile
            : event.files.map((file) => ({
                fileName: file.name,
                size: file.size,
                stage: "uploaded",
              })),
        createdAt: event.startedAt,
        updatedAt: event.startedAt,
      };

    case "file-stage":
      return {
        ...snapshot,
        updatedAt: event.at,
        perFile: upsertFile(snapshot.perFile, event.fileName, (entry) => ({
          ...entry,
          stage: event.stage,
          startedAt:
            entry.startedAt ??
            (event.stage !== "queued" && event.stage !== "uploaded"
              ? event.at
              : entry.startedAt),
        })),
      };

    case "file-completed":
      return {
        ...snapshot,
        updatedAt: event.at,
        completedFiles: snapshot.completedFiles + 1,
        perFile: upsertFile(snapshot.perFile, event.fileName, (entry) => ({
          ...entry,
          stage: "done",
          documentId: event.documentId,
          finishedAt: event.at,
        })),
      };

    case "file-failed":
      return {
        ...snapshot,
        updatedAt: event.at,
        failedFiles: snapshot.failedFiles + 1,
        perFile: upsertFile(snapshot.perFile, event.fileName, (entry) => ({
          ...entry,
          stage: "failed",
          errorMessage: event.message,
          finishedAt: event.at,
        })),
      };

    case "batch-completed":
      return {
        ...snapshot,
        status: "completed",
        updatedAt: event.at,
        completedFiles: event.completedFiles,
        failedFiles: event.failedFiles,
        result: event.result,
      };

    case "batch-failed":
      return {
        ...snapshot,
        status: "failed",
        updatedAt: event.at,
        completedFiles: event.completedFiles,
        failedFiles: event.failedFiles,
        error: event.message,
        result: event.result ?? snapshot.result,
      };
  }
}

export function foldBatchEvents(
  batchId: string,
  events: Iterable<BatchEvent>,
): IngestJobSnapshot {
  let snapshot = emptySnapshot(batchId);
  for (const event of events) {
    snapshot = applyBatchEvent(snapshot, event);
  }
  return snapshot;
}

function upsertFile(
  perFile: FileSnapshot[],
  fileName: string,
  update: (entry: FileSnapshot) => FileSnapshot,
): FileSnapshot[] {
  let found = false;
  const next = perFile.map((entry) => {
    if (entry.fileName === fileName) {
      found = true;
      return update(entry);
    }
    return entry;
  });
  if (!found) {
    next.push(
      update({
        fileName,
        stage: "uploaded",
      }),
    );
  }
  return next;
}
