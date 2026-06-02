"use client";

import { upload } from "@vercel/blob/client";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  Loader2,
  Upload as UploadIcon,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FilePipelineTracker } from "@/components/upload/file-pipeline-tracker";
import type { IngestJobSnapshot } from "@/lib/edison/ingest-job-store";
import type { ManualIngestResult } from "@/lib/edison/service";
import {
  ACCEPT_ATTR,
  ACCEPTED_UPLOAD_EXTENSIONS,
  ACCEPTED_UPLOAD_MIME_TYPES,
  BLOB_UPLOAD_TIMEOUT_MS,
  DIRECT_INGEST_MAX_BYTES,
  inferUploadContentType,
  MAX_UPLOAD_BYTES,
  shouldUseBlobMultipartUpload,
} from "@/lib/edison/upload-constraints";

type Status =
  | "idle"
  | "uploading"
  | "finalizing"
  | "processing"
  | "success"
  | "error";

interface UploadProgress {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  // Monotonic 0-100 for the current file. We never let this go backwards so
  // @vercel/blob's internal async-retry behavior doesn't show as a bouncing
  // progress bar.
  percentage: number;
  // 0-100 across the whole batch (uploaded bytes / total bytes).
  batchPercentage: number;
  retrying: boolean;
}

interface UploadBatchFormProps {
  blobReady: boolean;
}

type PromptTask = "diplomatic-transcription" | "project-notebook";

// Grace period before automatically moving the reviewer to the review tab,
// leaving a moment to grab the batch ZIP if they want it.
const REVIEW_REDIRECT_DELAY_MS = 1800;

export function UploadBatchForm({ blobReady }: UploadBatchFormProps) {
  const router = useRouter();
  const filesInputId = useId();
  const filesLabelId = useId();
  const folderInputId = useId();
  const promptInputId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [promptTask, setPromptTask] = useState<PromptTask>(
    "diplomatic-transcription",
  );
  const [status, setStatus] = useState<Status>("idle");
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
  const canDownload = Boolean(result && result.packages.length > 0);

  function cancelAutoRedirect() {
    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }
  }

  useEffect(() => cancelAutoRedirect, []);

  function reviewTarget(ingestResult: ManualIngestResult): string {
    const firstReviewable = ingestResult.packages.find(
      (pkg) => pkg.status === "needs_review",
    );
    const target = firstReviewable ?? ingestResult.packages[0];
    return target
      ? `/review?doc=${encodeURIComponent(target.documentId)}`
      : "/review";
  }

  function goToReview() {
    cancelAutoRedirect();
    if (result) {
      router.push(reviewTarget(result));
    } else {
      router.push("/review");
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (files.length === 0) {
      toast.error("Select at least one file before uploading.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const rawFolderId = formData.get("folderId");
    const folderId =
      typeof rawFolderId === "string" && rawFolderId.trim() !== ""
        ? rawFolderId.trim()
        : undefined;

    const validationError = validateFiles(files, blobReady);
    if (validationError) {
      setStatus("error");
      setErrorMessage(validationError);
      toast.error("Upload blocked", { description: validationError });
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    setStatus("uploading");
    setErrorMessage(null);
    setResult(null);
    setIngestJob(null);
    setUploadProgress(null);

    try {
      const job = blobReady
        ? await uploadFilesToBlob(
            files,
            folderId,
            promptTask,
            abortController.signal,
            setUploadProgress,
            () => setStatus("finalizing"),
          )
        : await uploadFilesDirectly(
            files,
            folderId,
            promptTask,
            abortController.signal,
          );

      setUploadProgress(null);
      setStatus("processing");
      setIngestJob(job);

      const finalJob = await waitForIngestJob(
        job.batchId,
        abortController.signal,
        setIngestJob,
      );

      if (!finalJob.result) {
        throw new Error("Job completed but no result payload was returned.");
      }
      setResult(finalJob.result);
      setStatus("success");
      setIngestJob(finalJob);
      const warnings = finalJob.result.transcriptionErrors.length;
      toast.success(
        `Processed ${finalJob.result.packages.length} file${
          finalJob.result.packages.length === 1 ? "" : "s"
        }`,
        {
          description:
            warnings > 0
              ? `${warnings} warning${warnings === 1 ? "" : "s"} — opening review.`
              : "Transcription complete — opening review.",
        },
      );
      const completedResult = finalJob.result;
      cancelAutoRedirect();
      redirectTimerRef.current = setTimeout(() => {
        redirectTimerRef.current = null;
        router.push(reviewTarget(completedResult));
      }, REVIEW_REDIRECT_DELAY_MS);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error.";
      setStatus("error");
      setErrorMessage(message);
      setUploadProgress(null);
      toast.error(
        abortController.signal.aborted ? "Upload canceled" : "Upload failed",
        { description: message },
      );
    } finally {
      abortControllerRef.current = null;
    }
  }

  function handleReset() {
    cancelAutoRedirect();
    abortControllerRef.current?.abort();
    setFiles([]);
    setResult(null);
    setStatus("idle");
    setErrorMessage(null);
    setUploadProgress(null);
    setIngestJob(null);
    formRef.current?.reset();
  }

  function handleCancel() {
    abortControllerRef.current?.abort();
  }

  async function handleDownload() {
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
  }

  return (
    <div className="space-y-6">
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="border border-border bg-card p-5"
      >
        <div className="grid gap-5 md:grid-cols-[2fr_1fr]">
          <div>
            <span
              id={filesLabelId}
              className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Files
            </span>
            <div className="mt-2 rounded-md border border-dashed border-border bg-background px-3 py-3">
              <input
                id={filesInputId}
                name="files"
                type="file"
                multiple
                accept={ACCEPT_ATTR}
                required
                disabled={busy}
                aria-labelledby={filesLabelId}
                onChange={(event) =>
                  setFiles(Array.from(event.currentTarget.files ?? []))
                }
                className="sr-only"
              />
              <div className="flex flex-wrap items-center gap-3">
                <label
                  htmlFor={filesInputId}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "default" }),
                    "cursor-pointer",
                    busy && "pointer-events-none opacity-50",
                  )}
                >
                  <UploadIcon aria-hidden="true" />
                  {files.length > 0 ? "Change files" : "Choose files"}
                </label>
                {files.length === 0 ? (
                  <span className="text-sm text-muted-foreground">
                    No files selected
                  </span>
                ) : null}
              </div>
            </div>
            <p className="mt-2 text-[12px] text-muted-foreground">
              PDFs and image files (JPEG, PNG, WebP, GIF, TIFF). Multi-page
              PDFs are sent whole to the OCR model.
            </p>
            {files.length > 0 ? (
              <>
                <p className="mt-1 text-[12px] text-foreground">
                  {files.length} file{files.length === 1 ? "" : "s"} selected ·{" "}
                  {humanFileSize(files.reduce((sum, f) => sum + f.size, 0))}
                </p>
                <ul className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
                  {files.map((file) => (
                    <li key={file.name} className="truncate font-mono">
                      {file.name}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
          <div className="space-y-4">
            <div>
              <label
                htmlFor={folderInputId}
                className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Folder ID
              </label>
              <input
                id={folderInputId}
                name="folderId"
                type="text"
                placeholder="D9032-F"
                className="mt-2 block h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                Optional. Used to mint Doc IDs like
                <code className="ml-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-[11px]">
                  D9032-00001
                </code>
                .
              </p>
            </div>
            <div>
              <label
                htmlFor={promptInputId}
                className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
              >
                Document type
              </label>
              <select
                id={promptInputId}
                name="promptTask"
                value={promptTask}
                onChange={(event) =>
                  setPromptTask(event.target.value as PromptTask)
                }
                className="mt-2 block h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="diplomatic-transcription">
                  Standard document (letters, telegrams)
                </option>
                <option value="project-notebook">
                  Project notebook (laboratory project log)
                </option>
              </select>
              <p className="mt-2 text-[12px] text-muted-foreground">
                Selects the canonical transcription prompt.
              </p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={busy}>
            {status === "uploading" ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Uploading
                {uploadProgress ? ` ${uploadProgress.batchPercentage}%` : ""}
              </>
            ) : status === "finalizing" ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Finalizing
              </>
            ) : status === "processing" ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Transcribing
              </>
            ) : (
              <>
                <UploadIcon aria-hidden="true" />
                Upload &amp; transcribe
              </>
            )}
          </Button>
          {busy ? (
            <Button type="button" variant="outline" onClick={handleCancel}>
              Cancel
            </Button>
          ) : null}
          {status !== "idle" ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={busy}
            >
              Start new batch
            </Button>
          ) : null}
          {canDownload ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Download aria-hidden="true" />
              )}
              Download batch ZIP
            </Button>
          ) : null}
        </div>

        {(status === "uploading" || status === "finalizing") &&
        uploadProgress ? (
          <UploadProgressBar
            progress={uploadProgress}
            finalizing={status === "finalizing"}
          />
        ) : null}
        {ingestJob && status === "processing" ? (
          <FilePipelineTracker job={ingestJob} />
        ) : null}

        {errorMessage ? (
          <p className="mt-3 text-sm text-rose-600">{errorMessage}</p>
        ) : null}
      </form>

      {status === "success" && result && result.packages.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border border-emerald-300 bg-emerald-50 px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <CheckCircle2
              className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
              strokeWidth={2}
              aria-hidden="true"
            />
            <div className="min-w-0 text-sm text-emerald-900">
              <p className="font-semibold">
                {result.packages.length} file
                {result.packages.length === 1 ? "" : "s"} transcribed
              </p>
              <p className="text-[13px] text-emerald-800">
                Opening review to verify side-by-side. Grab the batch ZIP first
                if you need it.
              </p>
            </div>
          </div>
          <Button type="button" onClick={goToReview}>
            Review &amp; verify
            <ArrowRight aria-hidden="true" />
          </Button>
        </div>
      ) : null}

    </div>
  );
}

function UploadProgressBar({
  progress,
  finalizing,
}: {
  progress: UploadProgress;
  finalizing: boolean;
}) {
  const displayedBatchPercentage = finalizing ? 100 : progress.batchPercentage;
  const hint = finalizing
    ? "All files uploaded. Starting the transcription workflow…"
    : progress.retrying
      ? `Network hiccup — retrying ${progress.fileName}. The bar is intentionally held steady.`
      : `${progress.fileName} · ${progress.percentage}%`;

  return (
    <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">
          {finalizing
            ? `Uploaded ${progress.totalFiles} file${progress.totalFiles === 1 ? "" : "s"}`
            : `Uploading file ${progress.fileIndex} of ${progress.totalFiles}`}
        </p>
        <p className="text-[12px] text-muted-foreground tabular-nums">
          {displayedBatchPercentage}%
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
          style={{ width: `${displayedBatchPercentage}%` }}
        />
      </div>
      <p
        className={`mt-2 truncate text-[12px] ${progress.retrying ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
      >
        {hint}
      </p>
    </div>
  );
}

// Treat a drop of this many percentage points as the @vercel/blob client
// retrying internally (it uses async-retry, which restarts the body upload
// on transient failures). Surfacing this avoids the perception of a hang.
const RETRY_DETECT_DROP_THRESHOLD = 5;

async function uploadFilesToBlob(
  files: File[],
  folderId: string | undefined,
  promptTask: PromptTask,
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
  onAllUploaded: () => void,
): Promise<IngestJobSnapshot> {
  const blobs: Array<{
    url: string;
    name: string;
    size: number;
    contentType: string;
  }> = [];

  const totalBytes = files.reduce((sum, f) => sum + f.size, 0) || 1;
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
      const batchPercentage = Math.min(
        100,
        Math.round((batchBytesSoFar / totalBytes) * 100),
      );
      onProgress({
        fileName: file.name,
        fileIndex: index + 1,
        totalFiles: files.length,
        percentage: Math.round(maxPercentage),
        batchPercentage,
        retrying,
      });
    };

    emit(0);
    const contentType = inferUploadContentType(file.name, file.type);
    const multipart = shouldUseBlobMultipartUpload(file.size);
    const result = await uploadWithTimeout(
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
      url: result.url,
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

const MAX_CONSECUTIVE_POLL_404S = 3;

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

function validateFiles(files: File[], blobReady: boolean): string | null {
  const acceptedExtensions = new Set<string>(ACCEPTED_UPLOAD_EXTENSIONS);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);

  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      return `${file.name} is ${humanFileSize(file.size)}. The per-file limit is ${humanFileSize(MAX_UPLOAD_BYTES)}.`;
    }
    const extension = `.${file.name.toLowerCase().split(".").at(-1) ?? ""}`;
    const mimeType = inferUploadContentType(file.name, file.type);
    if (
      !ACCEPTED_UPLOAD_MIME_TYPES.includes(
        mimeType as (typeof ACCEPTED_UPLOAD_MIME_TYPES)[number],
      ) &&
      !acceptedExtensions.has(extension)
    ) {
      return `${file.name} is not a supported PDF or image file.`;
    }
  }

  if (!blobReady && totalBytes > DIRECT_INGEST_MAX_BYTES) {
    return `Vercel Blob is not configured, so direct uploads are limited to ${humanFileSize(DIRECT_INGEST_MAX_BYTES)} per batch.`;
  }
  return null;
}

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
