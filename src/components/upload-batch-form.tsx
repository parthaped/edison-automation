"use client";

import { upload } from "@vercel/blob/client";
import { Download, Loader2, Upload as UploadIcon } from "lucide-react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  ManualIngestResult,
  TranscriptionError,
} from "@/lib/edison/service";
import type {
  DocumentPackage,
  TranscriptionRun,
} from "@/lib/edison/types";

const ACCEPTED_MIME = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
];

const ACCEPT_ATTR = ACCEPTED_MIME.join(",");

type Status = "idle" | "uploading" | "processing" | "success" | "error";

async function safeReadJson(
  response: Response,
): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text.slice(0, 400) || `HTTP ${response.status}` };
  }
}

interface PerFileRow {
  fileName: string;
  documentId?: string;
  status?: DocumentPackage["status"];
  confidence?: DocumentPackage["confidence"];
  textPreview?: string;
  metadataSummary?: string;
  errors: TranscriptionError[];
}

export function UploadBatchForm() {
  const filesInputId = useId();
  const folderInputId = useId();
  const formRef = useRef<HTMLFormElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<ManualIngestResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canDownload = Boolean(result && result.packages.length > 0);
  const [downloading, setDownloading] = useState(false);
  const rows: PerFileRow[] = buildPerFileRows(files, result);

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

    setStatus("uploading");
    setErrorMessage(null);
    setResult(null);

    try {
      // Step 1: upload each file directly to Vercel Blob from the browser.
      // This bypasses the 4.5 MB serverless function body limit.
      const blobs = [] as Array<{
        url: string;
        name: string;
        size: number;
        contentType: string;
      }>;
      for (const file of files) {
        const result = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/blob/upload-token",
          contentType: file.type || "application/octet-stream",
        });
        blobs.push({
          url: result.url,
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        });
      }

      // Step 2: hand the blob refs to the ingest pipeline. The server fetches
      // bytes from Blob, runs OCR + metadata extraction, and cleans up.
      setStatus("processing");
      const response = await fetch("/api/ingest/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blobs, folderId }),
      });
      const payload = (await safeReadJson(response)) as
        | ManualIngestResult
        | { error?: string };

      if (!response.ok) {
        const message =
          (payload as { error?: string }).error ??
          `Upload failed with status ${response.status}.`;
        setStatus("error");
        setErrorMessage(message);
        toast.error("Upload failed", { description: message });
        return;
      }

      const success = payload as ManualIngestResult;
      setResult(success);
      setStatus("success");
      toast.success(
        `Processed ${success.packages.length} file${success.packages.length === 1 ? "" : "s"}`,
        {
          description:
            success.transcriptionErrors.length > 0
              ? `${success.transcriptionErrors.length} transcription warning${success.transcriptionErrors.length === 1 ? "" : "s"} — see results below.`
              : "Transcription and metadata extraction complete.",
        },
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown network error.";
      setStatus("error");
      setErrorMessage(message);
      toast.error("Upload failed", { description: message });
    }
  }

  function handleReset() {
    setFiles([]);
    setResult(null);
    setStatus("idle");
    setErrorMessage(null);
    formRef.current?.reset();
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
        const message =
          body?.error ?? `Download failed with status ${response.status}.`;
        toast.error("Download failed", { description: message });
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
              PDFs and image files (JPEG, PNG, WebP, GIF, TIFF). Multi-page PDFs
              are sent whole to the OCR model.
            </p>
            {files.length > 0 ? (
              <p className="mt-1 text-[12px] text-foreground">
                {files.length} file{files.length === 1 ? "" : "s"} selected ·{" "}
                {humanFileSize(files.reduce((sum, f) => sum + f.size, 0))}
              </p>
            ) : null}
          </div>
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
              . Leave blank to use
              <code className="ml-1 rounded-sm bg-muted px-1 py-0.5 font-mono text-[11px]">
                UNASSIGNED-F
              </code>
              .
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            disabled={status === "uploading" || status === "processing"}
          >
            {status === "uploading" ? (
              <>
                <Loader2 className="animate-spin" aria-hidden="true" />
                Uploading
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
          {status !== "idle" ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleReset}
              disabled={status === "uploading" || status === "processing"}
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

        {errorMessage ? (
          <p className="mt-3 text-sm text-rose-600">{errorMessage}</p>
        ) : null}
      </form>

      {rows.length > 0 ? (
        <section
          aria-label="Batch results"
          className="border border-border bg-card"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
            <h2 className="text-[15px] font-semibold text-foreground">
              Batch results
            </h2>
            {result ? (
              <p className="text-[12px] text-muted-foreground">
                {result.packages.length} package
                {result.packages.length === 1 ? "" : "s"} ·{" "}
                {result.transcriptions.filter((t) => t.ocrText.length > 0).length}{" "}
                transcribed ·{" "}
                {result.transcriptionErrors.length} warning
                {result.transcriptionErrors.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </header>
          <ul className="divide-y divide-border">
            {rows.map((row) => (
              <li key={`${row.fileName}-${row.documentId ?? "pending"}`} className="px-5 py-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {row.fileName}
                    </p>
                    {row.documentId ? (
                      <p className="mt-0.5 font-mono text-[12px] text-muted-foreground">
                        {row.documentId}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    {row.status ? (
                      <StatusPill status={row.status} />
                    ) : null}
                    {row.confidence ? (
                      <ConfidencePill confidence={row.confidence} />
                    ) : null}
                  </div>
                </div>
                {row.metadataSummary ? (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    {row.metadataSummary}
                  </p>
                ) : null}
                {row.textPreview ? (
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 px-3 py-2 font-mono text-[12px] leading-snug text-foreground">
                    {row.textPreview}
                  </pre>
                ) : null}
                {row.errors.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-[12px] text-rose-600">
                    {row.errors.map((err, idx) => (
                      <li key={idx}>
                        <span className="font-semibold uppercase tracking-wide">
                          {err.stage}:
                        </span>{" "}
                        {err.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function buildPerFileRows(
  files: File[],
  result: ManualIngestResult | null,
): PerFileRow[] {
  if (!result) {
    if (files.length === 0) return [];
    return files.map((file) => ({ fileName: file.name, errors: [] }));
  }

  return result.packages.map((pkg, index) => {
    const fileName = pkg.sourceFile.name ?? files[index]?.name ?? pkg.documentId;
    const transcription: TranscriptionRun | undefined =
      result.transcriptions[index];
    const errors = result.transcriptionErrors.filter(
      (err) => err.fileName === fileName,
    );
    return {
      fileName,
      documentId: pkg.documentId,
      status: pkg.status,
      confidence: pkg.confidence,
      textPreview: transcription?.diplomaticText
        ? truncate(transcription.diplomaticText, 600)
        : undefined,
      metadataSummary: buildMetadataSummary(pkg.documentId, result),
      errors,
    };
  });
}

function buildMetadataSummary(
  documentId: string,
  _result: ManualIngestResult,
): string | undefined {
  // Metadata is not returned by the API today; intentionally omitted to keep
  // the UI honest. Reviewers see metadata in the workbench / ZIP download.
  void documentId;
  return undefined;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function humanFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

const STATUS_COLORS: Record<DocumentPackage["status"], string> = {
  queued: "bg-slate-100 text-slate-700",
  extracting: "bg-slate-100 text-slate-700",
  transcribing: "bg-slate-100 text-slate-700",
  needs_review: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  exported: "bg-emerald-100 text-emerald-800",
  blocked: "bg-rose-100 text-rose-700",
};

function StatusPill({ status }: { status: DocumentPackage["status"] }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COLORS[status]}`}
    >
      {status.replaceAll("_", " ")}
    </span>
  );
}

const CONFIDENCE_COLORS: Record<DocumentPackage["confidence"], string> = {
  high: "bg-emerald-100 text-emerald-800",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-rose-100 text-rose-700",
  blocked: "bg-slate-100 text-slate-700",
};

function ConfidencePill({
  confidence,
}: {
  confidence: DocumentPackage["confidence"];
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${CONFIDENCE_COLORS[confidence]}`}
    >
      {confidence} confidence
    </span>
  );
}
