"use client";

import { upload } from "@vercel/blob/client";
import { Download, Loader2, Upload as UploadIcon } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { FilePipelineTracker } from "@/components/upload/file-pipeline-tracker";
import { SourceTranscriptionRow } from "@/components/upload/source-transcription-row";
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

type Status = "idle" | "uploading" | "processing" | "success" | "error";

interface UploadProgress {
  fileName: string;
  fileIndex: number;
  totalFiles: number;
  percentage: number;
}

interface UploadBatchFormProps {
  blobReady: boolean;
}

type PromptTask = "diplomatic-transcription" | "project-notebook";

export function UploadBatchForm({ blobReady }: UploadBatchFormProps) {
  const filesInputId = useId();
  const folderInputId = useId();
  const promptInputId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
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

  const filesByName = useMemo(() => {
    const map = new Map<string, File>();
    for (const file of files) {
      map.set(file.name, file);
    }
    return map;
  }, [files]);

  const busy = status === "uploading" || status === "processing";
  const canDownload = Boolean(result && result.packages.length > 0);

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
              ? `${warnings} warning${warnings === 1 ? "" : "s"} — see results below.`
              : "Transcription and metadata extraction complete.",
        },
      );
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
            <label
              htmlFor={filesInputId}
              className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              Files
            </label>
            <input
              id={filesInputId}
              name="files"
              type="file"
              multiple
              accept={ACCEPT_ATTR}
              required
              onChange={(event) =>
                setFiles(Array.from(event.currentTarget.files ?? []))
              }
              className="mt-2 block w-full cursor-pointer rounded-md border border-dashed border-border bg-background px-3 py-3 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-foreground hover:file:bg-muted/80"
            />
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
                Uploading{uploadProgress ? ` ${uploadProgress.percentage}%` : ""}
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

        {uploadProgress ? <UploadProgressBar progress={uploadProgress} /> : null}
        {ingestJob && status === "processing" ? (
          <FilePipelineTracker job={ingestJob} />
        ) : null}

        {errorMessage ? (
          <p className="mt-3 text-sm text-rose-600">{errorMessage}</p>
        ) : null}
      </form>

      {result && result.packages.length > 0 ? (
        <section
          aria-label="Batch results"
          className="border border-border bg-card"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="text-[15px] font-semibold text-foreground">
              Source &amp; transcription
            </h2>
            <p className="text-[12px] text-muted-foreground">
              {result.packages.length} package
              {result.packages.length === 1 ? "" : "s"} ·{" "}
              {result.transcriptionErrors.length} warning
              {result.transcriptionErrors.length === 1 ? "" : "s"}
            </p>
          </header>
          {result.packages.map((pkg, index) => (
            <SourceTranscriptionRow
              key={pkg.documentId}
              documentPackage={pkg}
              transcription={result.transcriptions[index]}
              metadata={result.metadata[index]}
              sourceFile={filesByName.get(pkg.sourceFile.name)}
              errors={result.transcriptionErrors.filter(
                (entry) => entry.fileName === pkg.sourceFile.name,
              )}
            />
          ))}
        </section>
      ) : null}
    </div>
  );
}

function UploadProgressBar({ progress }: { progress: UploadProgress }) {
  return (
    <div className="mt-4 rounded-md border border-border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium text-foreground">
          Uploading {progress.fileIndex} of {progress.totalFiles}:{" "}
          {progress.fileName}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {progress.percentage}%
        </p>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-background">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${progress.percentage}%` }}
        />
      </div>
    </div>
  );
}

async function uploadFilesToBlob(
  files: File[],
  folderId: string | undefined,
  promptTask: PromptTask,
  signal: AbortSignal,
  onProgress: (progress: UploadProgress) => void,
): Promise<IngestJobSnapshot> {
  const blobs: Array<{
    url: string;
    name: string;
    size: number;
    contentType: string;
  }> = [];

  for (const [index, file] of files.entries()) {
    onProgress({
      fileName: file.name,
      fileIndex: index + 1,
      totalFiles: files.length,
      percentage: 0,
    });
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
        onUploadProgress: (progress) => {
          onProgress({
            fileName: file.name,
            fileIndex: index + 1,
            totalFiles: files.length,
            percentage: Math.round(progress.percentage),
          });
        },
      },
      signal,
    );
    blobs.push({
      url: result.url,
      name: file.name,
      size: file.size,
      contentType,
    });
  }

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
