"use client";

import {
  ArrowRight,
  CheckCircle2,
  Download,
  Loader2,
  Upload as UploadIcon,
} from "lucide-react";
import Link from "next/link";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FilePipelineTracker } from "@/components/upload/file-pipeline-tracker";
import {
  type PromptTask,
  type UploadProgress,
  useActiveIngest,
} from "@/components/workbench/active-ingest-provider";
import {
  ACCEPT_ATTR,
  ACCEPTED_UPLOAD_EXTENSIONS,
  ACCEPTED_UPLOAD_MIME_TYPES,
  DIRECT_INGEST_MAX_BYTES,
  inferUploadContentType,
  MAX_UPLOAD_BYTES,
  partitionFilesIntoUploadBatches,
} from "@/lib/edison/upload-constraints";

interface UploadBatchFormProps {
  blobReady: boolean;
}

export function UploadBatchForm({ blobReady }: UploadBatchFormProps) {
  const filesInputId = useId();
  const filesLabelId = useId();
  const folderInputId = useId();
  const promptInputId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [promptTask, setPromptTask] = useState<PromptTask>(
    "diplomatic-transcription",
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const {
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
  } = useActiveIngest();
  const [downloading, setDownloading] = useState(false);
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
      setValidationError(validationError);
      toast.error("Upload blocked", { description: validationError });
      return;
    }

    setValidationError(null);
    await startIngest({ files, folderId, promptTask, blobReady });
  }

  function handleReset() {
    resetIngest();
    setFiles([]);
    setValidationError(null);
    formRef.current?.reset();
  }

  function handleCancel() {
    cancelIngest();
  }

  async function handleDownload() {
    if (!result) return;
    setDownloading(true);
    try {
      await downloadBatch();
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
                placeholder="E2002"
                className="mt-2 block h-9 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              <p className="mt-2 text-[12px] text-muted-foreground">
                Leave blank to use each file&apos;s name as its folder (e.g.
                <code className="mx-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-[11px]">
                  E2002.pdf
                </code>
                {"\u2192"} folder
                <code className="mx-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-[11px]">
                  E2002
                </code>
                , doc
                <code className="mx-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-[11px]">
                  E2002AAA
                </code>
                ). You can rename it from the Review tab afterwards.
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

        {validationError || errorMessage ? (
          <p className="mt-3 text-sm text-rose-600">
            {validationError ?? errorMessage}
          </p>
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
          <Button render={<Link href={reviewHref} />}>
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
            : progress.totalUploadBatches > 1
              ? `Upload batch ${progress.uploadBatchIndex} of ${progress.totalUploadBatches} · file ${progress.fileIndex} of ${progress.totalFiles}`
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

  if (blobReady) {
    try {
      partitionFilesIntoUploadBatches(files);
    } catch (error) {
      if (error instanceof Error) {
        return error.message;
      }
      return "Upload could not be split into valid batches.";
    }
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
