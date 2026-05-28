"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { BoxUpload, BoxUploadStatus } from "@/lib/edison/types";

interface BoxUploadQueueProps {
  uploads: BoxUpload[];
}

export function BoxUploadQueue({ uploads }: BoxUploadQueueProps) {
  const [statuses, setStatuses] = useState<Record<string, BoxUploadStatus>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const visibleUploads = uploads.filter((upload) =>
    ["available", "queued_for_pipeline"].includes(statuses[upload.id] ?? upload.status),
  );
  const availableUploads = visibleUploads.filter(
    (upload) => (statuses[upload.id] ?? upload.status) === "available",
  );

  async function startTranscription(upload: BoxUpload) {
    setPending((current) => ({ ...current, [upload.id]: true }));
    setErrors((current) => {
      const next = { ...current };
      delete next[upload.id];
      return next;
    });
    try {
      const response = await fetch(
        `/api/box/uploads/${encodeURIComponent(upload.id)}/start-transcription`,
        { method: "POST" },
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          detail || `Unable to start transcription (HTTP ${response.status}).`,
        );
      }
      setStatuses((current) => ({
        ...current,
        [upload.id]: "queued_for_pipeline",
      }));
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [upload.id]:
          error instanceof Error ? error.message : "Unable to start transcription.",
      }));
    } finally {
      setPending((current) => {
        const next = { ...current };
        delete next[upload.id];
        return next;
      });
    }
  }

  return (
    <section className="border border-border bg-card">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Box intake
          </p>
          <h2 className="mt-1 text-[18px] font-semibold text-foreground">
            New Box uploads waiting for user action
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Box uploads are recorded here after they finish uploading. They do not enter
            the transcription pipeline until a platform user explicitly starts them.
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-muted px-2.5 py-1 text-[12px] font-medium text-foreground">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-slate-500" />
          {availableUploads.length} ready to start
        </span>
      </header>

      {visibleUploads.length === 0 ? (
        <div className="border-t border-dashed border-border bg-muted/40 px-5 py-6 text-sm text-muted-foreground">
          No completed Box uploads are waiting. Newly uploaded Box files will appear here
          with their associated folder.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {visibleUploads.map((upload) => {
            const status = statuses[upload.id] ?? upload.status;
            const isPending = pending[upload.id] === true;
            const error = errors[upload.id];
            const buttonLabel = isPending
              ? "Starting…"
              : status === "available"
                ? "Start transcription"
                : "Queued for pipeline";
            return (
              <li
                key={upload.id}
                className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto] lg:items-center"
              >
                <div>
                  <h3 className="font-mono text-[14px] font-semibold text-foreground">
                    {upload.fileName}
                  </h3>
                  <dl className="mt-3 grid gap-y-2 text-sm md:grid-cols-3 md:gap-x-6">
                    <Field label="Box folder" value={upload.folderName} />
                    <Field label="Folder path" value={upload.folderPath} mono />
                    <Field label="Size" value={formatBytes(upload.fileSize)} />
                  </dl>
                  {error ? (
                    <p
                      role="alert"
                      className="mt-3 text-sm font-medium text-destructive"
                    >
                      {error}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center lg:justify-end">
                  <Button
                    type="button"
                    size="default"
                    disabled={status !== "available" || isPending}
                    onClick={() => void startTranscription(upload)}
                  >
                    {buttonLabel}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Field({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd
        className={
          "mt-0.5 text-foreground" + (mono ? " font-mono text-[13px]" : "")
        }
      >
        {value}
      </dd>
    </div>
  );
}

function formatBytes(value?: number): string {
  if (!value) return "Unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
