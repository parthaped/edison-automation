import { CheckCircle2, Circle, Loader2, XCircle } from "lucide-react";
import type {
  FileSnapshot,
  FileStage,
  IngestJobSnapshot,
} from "@/lib/edison/ingest-job-store";

const STAGE_ORDER: FileStage[] = [
  "uploaded",
  "fetching",
  "transcribing",
  "rasterizing",
  "saving",
  "done",
];

const STAGE_LABEL: Record<FileStage, string> = {
  queued: "Queued",
  uploaded: "Uploaded",
  fetching: "Fetching",
  transcribing: "Transcribing",
  rasterizing: "Rendering pages",
  saving: "Saving",
  done: "Done",
  failed: "Failed",
};

interface FilePipelineTrackerProps {
  job: IngestJobSnapshot;
}

export function FilePipelineTracker({ job }: FilePipelineTrackerProps) {
  return (
    <section
      aria-label="Per-file processing"
      className="mt-4 rounded-md border border-border bg-muted/30 p-3"
    >
      <header className="flex items-center justify-between gap-3">
        <p className="text-[13px] font-semibold text-foreground">
          Processing {job.totalFiles} file
          {job.totalFiles === 1 ? "" : "s"}
        </p>
        <p className="text-[12px] text-muted-foreground">
          {job.completedFiles} done · {job.failedFiles} failed
        </p>
      </header>
      <ul className="mt-3 space-y-2">
        {job.perFile.map((file) => (
          <li
            key={file.fileName}
            className="rounded-sm border border-border bg-background px-3 py-2"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="truncate text-[13px] font-medium text-foreground">
                {file.fileName}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {STAGE_LABEL[file.stage]}
                {file.documentId ? ` · ${file.documentId}` : ""}
              </p>
            </div>
            <StageBar file={file} />
            {file.errorMessage ? (
              <p className="mt-1.5 text-[12px] text-rose-600">
                {file.errorMessage}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function StageBar({ file }: { file: FileSnapshot }) {
  const isFailed = file.stage === "failed";
  const currentIndex = isFailed
    ? STAGE_ORDER.length - 1
    : STAGE_ORDER.indexOf(file.stage);

  return (
    <ol
      role="list"
      className="mt-2 flex items-center gap-1 overflow-x-auto"
      aria-label="Pipeline stages"
    >
      {STAGE_ORDER.map((stage, index) => {
        const status = isFailed
          ? index <= currentIndex - 1
            ? "complete"
            : "failed"
          : index < currentIndex
            ? "complete"
            : index === currentIndex
              ? "active"
              : "pending";
        return (
          <li
            key={stage}
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <StageIcon status={status} />
            <span
              className={
                status === "active"
                  ? "font-medium text-foreground"
                  : status === "complete"
                    ? "text-foreground"
                    : status === "failed"
                      ? "text-rose-700"
                      : ""
              }
            >
              {STAGE_LABEL[stage]}
            </span>
            {index < STAGE_ORDER.length - 1 ? (
              <span aria-hidden="true" className="text-muted-foreground/50">
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function StageIcon({
  status,
}: {
  status: "complete" | "active" | "pending" | "failed";
}) {
  if (status === "complete") {
    return (
      <CheckCircle2
        className="h-3.5 w-3.5 text-emerald-600"
        aria-hidden="true"
        strokeWidth={2}
      />
    );
  }
  if (status === "active") {
    return (
      <Loader2
        className="h-3.5 w-3.5 animate-spin text-primary"
        aria-hidden="true"
        strokeWidth={2}
      />
    );
  }
  if (status === "failed") {
    return (
      <XCircle
        className="h-3.5 w-3.5 text-rose-600"
        aria-hidden="true"
        strokeWidth={2}
      />
    );
  }
  return (
    <Circle
      className="h-3.5 w-3.5 text-muted-foreground"
      aria-hidden="true"
      strokeWidth={1.5}
    />
  );
}
