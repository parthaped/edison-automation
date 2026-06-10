"use client";

import { upload } from "@vercel/blob/client";
import { ArrowRight, CheckCircle2, Loader2, XCircle } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  BLOB_UPLOAD_TIMEOUT_MS,
  inferUploadContentType,
  partitionFilesIntoUploadBatches,
  shouldUseBlobMultipartUpload,
} from "@/lib/edison/upload-constraints";
import type { IngestJobSnapshot } from "@/lib/edison/ingest-job-store";
import type { ManualIngestResult } from "@/lib/edison/service";

export type ActiveIngestStatus =
  | "idle"
  | "uploading"
  | "finalizing"
  | "processing"
  | "success"
  | "error";

export interface UploadProgress {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  uploadBatchIndex: number;
  totalUploadBatches: number;
  percentage: number;
  batchPercentage: number;
  retrying: boolean;
}

export type PromptTask = "diplomatic-transcription" | "project-notebook";

interface StartIngestOptions {
  files: File[];
  folderId?: string;
  promptTask: PromptTask;
  blobReady: boolean;
}

interface ActiveIngestContextValue {
  status: ActiveIngestStatus;
  result: ManualIngestResult | null;
  errorMessage: string | null;
  uploadProgress: UploadProgress | null;
  ingestJob: IngestJobSnapshot | null;
  busy: boolean;
  reviewHref: string;
  startIngest: (options: StartIngestOptions) => Promise<void>;
  cancelIngest: () => void;
  resetIngest: () => void;
  downloadBatch: () => Promise<void>;
}

const ActiveIngestContext = createContext<ActiveIngestContextValue | null>(null);
const ACTIVE_BATCH_STORAGE_KEY = "edison.activeIngestBatchId";
const REVIEW_REDIRECT_DELAY_MS = 1800;
const MAX_CONSECUTIVE_POLL_404S = 3;
const RETRY_DETECT_DROP_THRESHOLD = 5;

export function ActiveIngestProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const abortControllerRef = useRef<AbortController | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pathnameRef = useRef(pathname);
  const [initialBatchId] = useState(readStoredBatchId);
  const [status, setStatus] = useState<ActiveIngestStatus>(
    initialBatchId ? "processing" : "idle",
  );
  const [result, setResult] = useState<ManualIngestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(
    null,
  );
  const [ingestJob, setIngestJob] = useState<IngestJobSnapshot | null>(null);
  const [downloading, setDownloading] = useState(false);

  const busy =
    status === "uploading" ||
    status === "finalizing" ||
    status === "processing";
  const reviewHref = result ? reviewTarget(result) : "/workbench/review";

  const cancelAutoRedirect = useCallback(() => {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  }, []);

  const handleCompletedResult = useCallback(
    (completedResult: ManualIngestResult, uploadBatchCount: number) => {
      const warnings = completedResult.transcriptionErrors.length;
      toast.success(
        `Processed ${completedResult.packages.length} file${
          completedResult.packages.length === 1 ? "" : "s"
        }`,
        {
          description:
            warnings > 0
              ? `${warnings} warning${warnings === 1 ? "" : "s"} — opening review.`
              : uploadBatchCount > 1
                ? `Uploaded in ${uploadBatchCount} batches — opening review.`
                : "Transcription complete — opening review.",
        },
      );
      cancelAutoRedirect();
      redirectTimerRef.current = setTimeout(() => {
        redirectTimerRef.current = null;
        if (pathnameRef.current === "/workbench/review") {
          router.refresh();
        } else {
          router.push(reviewTarget(completedResult));
        }
      }, REVIEW_REDIRECT_DELAY_MS);
    },
    [cancelAutoRedirect, router],
  );

  const resumeIngestJob = useCallback(async (
    batchId: string,
    signal: AbortSignal,
  ) => {
    try {
      const finalJob = await waitForIngestJob(batchId, signal, setIngestJob);
      clearStoredBatchId(batchId);
      if (!finalJob.result) {
        throw new Error("Job completed but no result payload was returned.");
      }
      setResult(finalJob.result);
      setStatus("success");
      setIngestJob(finalJob);
      handleCompletedResult(finalJob.result, 1);
    } catch (error) {
      if (signal.aborted) return;
      const message =
        error instanceof Error ? error.message : "Unknown network error.";
      clearStoredBatchId(batchId);
      setStatus("error");
      setErrorMessage(message);
      setUploadProgress(null);
      toast.error("Upload failed", { description: message });
    } finally {
      if (abortControllerRef.current?.signal === signal) {
        abortControllerRef.current = null;
      }
    }
  }, [handleCompletedResult]);

  const startIngest = useCallback(async ({
    files,
    folderId,
    promptTask,
    blobReady,
  }: StartIngestOptions) => {
    cancelAutoRedirect();
    abortControllerRef.current?.abort();

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setStatus("uploading");
    setErrorMessage(null);
    setResult(null);
    setIngestJob(null);
    setUploadProgress(null);
    clearStoredBatchId();

    try {
      const uploadBatches = blobReady
        ? partitionFilesIntoUploadBatches(files)
        : [files];
      const totalSelectionBytes =
        files.reduce((sum, file) => sum + file.size, 0) || 1;
      let bytesFromCompletedBatches = 0;
      let fileIndexOffset = 0;
      let mergedResult: ManualIngestResult | null = null;
      let lastJob: IngestJobSnapshot | null = null;

      for (const [batchIndex, batchFiles] of uploadBatches.entries()) {
        const job = blobReady
          ? await uploadFilesToBlob(
              batchFiles,
              folderId,
              promptTask,
              abortController.signal,
              setUploadProgress,
              () => setStatus("finalizing"),
              {
                totalFiles: files.length,
                fileIndexOffset,
                totalBytes: totalSelectionBytes,
                bytesBeforeBatch: bytesFromCompletedBatches,
                uploadBatchIndex: batchIndex + 1,
                totalUploadBatches: uploadBatches.length,
              },
            )
          : await uploadFilesDirectly(
              batchFiles,
              folderId,
              promptTask,
              abortController.signal,
            );

        persistBatchId(job.batchId);
        setUploadProgress(null);
        setStatus("processing");
        setIngestJob(job);
        lastJob = job;

        const finalJob = await waitForIngestJob(
          job.batchId,
          abortController.signal,
          setIngestJob,
        );
        clearStoredBatchId(job.batchId);

        if (!finalJob.result) {
          throw new Error("Job completed but no result payload was returned.");
        }

        mergedResult = mergedResult
          ? mergeIngestResults(mergedResult, finalJob.result)
          : finalJob.result;
        bytesFromCompletedBatches += batchFiles.reduce(
          (sum, file) => sum + file.size,
          0,
        );
        fileIndexOffset += batchFiles.length;
      }

      if (!mergedResult || !lastJob) {
        throw new Error("Upload did not produce any ingest results.");
      }

      setResult(mergedResult);
      setStatus("success");
      setIngestJob(lastJob);
      handleCompletedResult(mergedResult, uploadBatches.length);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error.";
      setStatus("error");
      setErrorMessage(message);
      setUploadProgress(null);
      clearStoredBatchId();
      toast.error(
        abortController.signal.aborted ? "Upload canceled" : "Upload failed",
        { description: message },
      );
    } finally {
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    }
  }, [cancelAutoRedirect, handleCompletedResult]);

  const resetIngest = useCallback(() => {
    cancelAutoRedirect();
    abortControllerRef.current?.abort();
    clearStoredBatchId();
    setResult(null);
    setStatus("idle");
    setErrorMessage(null);
    setUploadProgress(null);
    setIngestJob(null);
  }, [cancelAutoRedirect]);

  const cancelIngest = useCallback(() => {
    abortControllerRef.current?.abort();
  }, []);

  const downloadBatch = useCallback(async () => {
    if (!result) return;
    cancelAutoRedirect();
    setDownloading(true);
    try {
      const response = await fetch("/api/export/batch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          packages: result.packages,
          transcriptions: result.transcriptions,
          metadata: result.metadata,
        }),
      });
      if (!response.ok) {
        const body = (await safeReadJson(response)) as { error?: string };
        toast.error("Download failed", {
          description:
            body?.error ?? `Download failed with status ${response.status}.`,
        });
        return;
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const fileName = match?.[1] ?? "edison-batch.zip";
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown download error.";
      toast.error("Download failed", { description: message });
    } finally {
      setDownloading(false);
    }
  }, [cancelAutoRedirect, result]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => cancelAutoRedirect, [cancelAutoRedirect]);

  useEffect(() => {
    if (!initialBatchId) return;

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const resumeTimer = window.setTimeout(() => {
      void resumeIngestJob(initialBatchId, abortController.signal);
    }, 0);

    return () => {
      window.clearTimeout(resumeTimer);
      abortController.abort();
      if (abortControllerRef.current === abortController) {
        abortControllerRef.current = null;
      }
    };
  }, [initialBatchId, resumeIngestJob]);

  const value: ActiveIngestContextValue = {
    status,
    result,
    errorMessage,
    uploadProgress,
    ingestJob,
    busy,
    reviewHref,
    startIngest,
    cancelIngest,
    resetIngest,
    downloadBatch,
  };

  return (
    <ActiveIngestContext.Provider value={value}>
      {children}
      <ActiveIngestStatusBanner
        status={status}
        result={result}
        errorMessage={errorMessage}
        uploadProgress={uploadProgress}
        ingestJob={ingestJob}
        reviewHref={reviewHref}
        downloading={downloading}
        onCancel={cancelIngest}
        onReset={resetIngest}
        onDownload={downloadBatch}
      />
    </ActiveIngestContext.Provider>
  );
}

export function useActiveIngest() {
  const context = useContext(ActiveIngestContext);
  if (!context) {
    throw new Error("useActiveIngest must be used within ActiveIngestProvider.");
  }
  return context;
}

function ActiveIngestStatusBanner({
  status,
  result,
  errorMessage,
  uploadProgress,
  ingestJob,
  reviewHref,
  downloading,
  onCancel,
  onReset,
  onDownload,
}: {
  status: ActiveIngestStatus;
  result: ManualIngestResult | null;
  errorMessage: string | null;
  uploadProgress: UploadProgress | null;
  ingestJob: IngestJobSnapshot | null;
  reviewHref: string;
  downloading: boolean;
  onCancel: () => void;
  onReset: () => void;
  onDownload: () => void;
}) {
  if (status === "idle") return null;

  const isBusy =
    status === "uploading" ||
    status === "finalizing" ||
    status === "processing";
  const title =
    status === "uploading"
      ? `Uploading${uploadProgress ? ` ${uploadProgress.batchPercentage}%` : ""}`
      : status === "finalizing"
        ? "Starting transcription"
        : status === "processing"
          ? "Transcribing"
          : status === "success"
            ? "Transcription complete"
            : "Upload failed";
  const description =
    status === "uploading" && uploadProgress
      ? `${uploadProgress.fileName} · file ${uploadProgress.fileIndex} of ${uploadProgress.totalFiles}`
      : status === "finalizing"
        ? "All files uploaded. The transcription workflow is being queued."
        : status === "processing" && ingestJob
          ? `${ingestJob.completedFiles} of ${ingestJob.totalFiles} done · ${ingestJob.failedFiles} failed`
          : status === "success" && result
            ? `${result.packages.length} file${result.packages.length === 1 ? "" : "s"} ready for review.`
            : errorMessage;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-[min(420px,calc(100vw-2rem))] border border-border bg-card p-3 shadow-lg">
      <div className="flex items-start gap-3">
        {status === "success" ? (
          <CheckCircle2
            className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
            aria-hidden="true"
          />
        ) : status === "error" ? (
          <XCircle
            className="mt-0.5 h-4 w-4 shrink-0 text-rose-600"
            aria-hidden="true"
          />
        ) : (
          <Loader2
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary"
            aria-hidden="true"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          {description ? (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {description}
            </p>
          ) : null}
          {isBusy && uploadProgress ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
                style={{
                  width: `${
                    status === "finalizing" ? 100 : uploadProgress.batchPercentage
                  }%`,
                }}
              />
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {isBusy ? (
              <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                Cancel
              </Button>
            ) : null}
            {status === "success" && result ? (
              <>
                <Button size="sm" render={<Link href={reviewHref} />}>
                  Review
                  <ArrowRight aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={downloading}
                  onClick={onDownload}
                >
                  {downloading ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : null}
                  Download ZIP
                </Button>
              </>
            ) : null}
            {!isBusy ? (
              <Button type="button" variant="outline" size="sm" onClick={onReset}>
                Dismiss
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

interface UploadScope {
  totalFiles: number;
  fileIndexOffset: number;
  totalBytes: number;
  bytesBeforeBatch: number;
  uploadBatchIndex: number;
  totalUploadBatches: number;
}

async function uploadFilesToBlob(
  files: File[],
  folderId: string | undefined,
  promptTask: PromptTask,
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
  onAllUploaded: () => void,
  scope?: UploadScope,
): Promise<IngestJobSnapshot> {
  const blobs: Array<{
    url: string;
    name: string;
    size: number;
    contentType: string;
  }> = [];

  const batchBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;
  let bytesFromCompletedFiles = 0;

  for (const [index, file] of files.entries()) {
    let maxPercentage = 0;
    let lastRawPercentage = 0;
    let retrying = false;

    const emit = (rawPercentage: number) => {
      const clamped = Math.max(0, Math.min(100, rawPercentage));
      if (clamped + RETRY_DETECT_DROP_THRESHOLD < lastRawPercentage) {
        retrying = true;
      } else if (clamped >= maxPercentage) {
        retrying = false;
      }
      lastRawPercentage = clamped;
      maxPercentage = Math.max(maxPercentage, clamped);
      const batchBytesSoFar =
        bytesFromCompletedFiles + (file.size * maxPercentage) / 100;
      const overallBytesSoFar =
        (scope?.bytesBeforeBatch ?? 0) + batchBytesSoFar;
      const overallTotalBytes = scope?.totalBytes ?? batchBytes;
      const batchPercentage = Math.min(
        100,
        Math.round((overallBytesSoFar / overallTotalBytes) * 100),
      );
      onProgress({
        fileName: file.name,
        fileIndex: (scope?.fileIndexOffset ?? 0) + index + 1,
        totalFiles: scope?.totalFiles ?? files.length,
        uploadBatchIndex: scope?.uploadBatchIndex ?? 1,
        totalUploadBatches: scope?.totalUploadBatches ?? 1,
        percentage: Math.round(maxPercentage),
        batchPercentage,
        retrying,
      });
    };

    emit(0);
    const contentType = inferUploadContentType(file.name, file.type);
    const multipart = shouldUseBlobMultipartUpload(file.size);
    const uploaded = await uploadWithTimeout(
      file.name,
      file,
      {
        access: "public",
        handleUploadUrl: "/api/blob/upload-token",
        contentType,
        multipart,
        onUploadProgress: (progress) => emit(progress.percentage),
      },
      signal,
    );
    bytesFromCompletedFiles += file.size;
    emit(100);
    blobs.push({
      url: uploaded.url,
      name: file.name,
      size: file.size,
      contentType,
    });
  }

  onAllUploaded();
  const response = await fetch("/api/ingest/manual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ blobs, folderId, promptTask }),
    signal,
  });
  return parseJobResponse(response);
}

async function uploadFilesDirectly(
  files: File[],
  folderId: string | undefined,
  promptTask: PromptTask,
  signal: AbortSignal,
): Promise<IngestJobSnapshot> {
  const formData = new FormData();
  for (const file of files) {
    formData.append("files", file);
  }
  if (folderId) {
    formData.append("folderId", folderId);
  }
  formData.append("promptTask", promptTask);
  const response = await fetch("/api/ingest/manual", {
    method: "POST",
    body: formData,
    signal,
  });
  return parseJobResponse(response);
}

async function uploadWithTimeout(
  pathname: string,
  body: File,
  options: Parameters<typeof upload>[2],
  signal: AbortSignal,
) {
  const uploadController = new AbortController();
  const onParentAbort = () => uploadController.abort();
  signal.addEventListener("abort", onParentAbort, { once: true });
  const timeoutId = setTimeout(
    () => uploadController.abort(),
    BLOB_UPLOAD_TIMEOUT_MS,
  );

  try {
    return await upload(pathname, body, {
      ...options,
      abortSignal: uploadController.signal,
    });
  } catch (error) {
    if (uploadController.signal.aborted && !signal.aborted) {
      throw new Error(
        `Upload timed out after ${BLOB_UPLOAD_TIMEOUT_MS / 1000} seconds. Check your network connection and try again.`,
      );
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", onParentAbort);
  }
}

async function parseJobResponse(response: Response): Promise<IngestJobSnapshot> {
  const payload = (await safeReadJson(response)) as
    | IngestJobSnapshot
    | ErrorPayload;
  if (!response.ok) {
    throw new Error(
      getErrorMessage(payload, `Upload failed with status ${response.status}.`),
    );
  }
  if (!isJobSnapshot(payload)) {
    throw new Error("Upload did not return a batch id.");
  }
  return payload;
}

async function waitForIngestJob(
  batchId: string,
  signal: AbortSignal,
  onUpdate: (job: IngestJobSnapshot) => void,
): Promise<IngestJobSnapshot> {
  let consecutive404s = 0;

  while (!signal.aborted) {
    const response = await fetch(`/api/ingest/manual/${batchId}`, {
      cache: "no-store",
      signal,
    });
    const payload = (await safeReadJson(response)) as
      | IngestJobSnapshot
      | ErrorPayload;

    if (response.status === 404) {
      consecutive404s += 1;
      if (consecutive404s <= MAX_CONSECUTIVE_POLL_404S) {
        await sleep(1000, signal);
        continue;
      }
      throw new Error(
        getErrorMessage(
          payload,
          "Batch is no longer available. Please retry the upload.",
        ),
      );
    }
    if (!response.ok) {
      throw new Error(
        getErrorMessage(
          payload,
          `Batch status failed with ${response.status}.`,
        ),
      );
    }
    if (!isJobSnapshot(payload)) {
      throw new Error("Batch status response did not include a batch id.");
    }
    consecutive404s = 0;
    onUpdate(payload);
    if (payload.status === "completed") {
      return payload;
    }
    if (payload.status === "failed") {
      throw new Error(payload.error ?? "Transcription failed.");
    }
    await sleep(1000, signal);
  }
  throw new Error("Upload canceled.");
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new Error("Upload canceled."));
      },
      { once: true },
    );
  });
}

type ErrorPayload =
  | { error?: string }
  | { error?: { message?: string; code?: string } };

function isJobSnapshot(payload: unknown): payload is IngestJobSnapshot {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "batchId" in payload &&
    "status" in payload
  );
}

function getErrorMessage(
  payload: ErrorPayload | unknown,
  fallback: string,
): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as ErrorPayload).error;
    if (typeof error === "string" && error.trim()) return error;
    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof error.message === "string" &&
      error.message.trim()
    ) {
      return error.message;
    }
  }
  return fallback;
}

async function safeReadJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 400) || `HTTP ${response.status}` };
  }
}

function mergeIngestResults(
  left: ManualIngestResult,
  right: ManualIngestResult,
): ManualIngestResult {
  return {
    packages: [...left.packages, ...right.packages],
    transcriptions: [...left.transcriptions, ...right.transcriptions],
    metadata: [...left.metadata, ...right.metadata],
    transcriptionErrors: [
      ...left.transcriptionErrors,
      ...right.transcriptionErrors,
    ],
  };
}

function reviewTarget(ingestResult: ManualIngestResult): string {
  const firstReviewable = ingestResult.packages.find(
    (pkg) => pkg.status === "needs_review",
  );
  const target = firstReviewable ?? ingestResult.packages[0];
  return target ? `/workbench/review?doc=${encodeURIComponent(target.documentId)}` : "/workbench/review";
}

function readStoredBatchId(): string | null {
  try {
    return window.sessionStorage.getItem(ACTIVE_BATCH_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistBatchId(batchId: string) {
  try {
    window.sessionStorage.setItem(ACTIVE_BATCH_STORAGE_KEY, batchId);
  } catch {
    // Polling still works for this tab even when storage is unavailable.
  }
}

function clearStoredBatchId(batchId?: string) {
  try {
    if (batchId && window.sessionStorage.getItem(ACTIVE_BATCH_STORAGE_KEY) !== batchId) {
      return;
    }
    window.sessionStorage.removeItem(ACTIVE_BATCH_STORAGE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}
