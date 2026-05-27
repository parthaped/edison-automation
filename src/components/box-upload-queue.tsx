"use client";

import { useState } from "react";
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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Box intake
          </p>
          <h2 className="text-2xl font-semibold text-slate-950">
            New Box uploads waiting for user action
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Box uploads are recorded here after they finish uploading. They do not enter
            the transcription pipeline until a platform user explicitly starts them.
          </p>
        </div>
        <span className="rounded-full bg-amber-100 px-4 py-2 text-sm font-semibold text-amber-800">
          {availableUploads.length} ready to start
        </span>
      </div>

      {visibleUploads.length === 0 ? (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
          No completed Box uploads are waiting. Newly uploaded Box files will appear here
          with their associated folder.
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
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
              <article
                key={upload.id}
                className="grid gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:grid-cols-[1fr_auto]"
              >
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">{upload.fileName}</h3>
                  <dl className="mt-3 grid gap-2 text-sm text-slate-700 md:grid-cols-3">
                    <div>
                      <dt className="font-semibold text-slate-500">Box folder</dt>
                      <dd>{upload.folderName}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Folder path</dt>
                      <dd>{upload.folderPath}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-slate-500">Size</dt>
                      <dd>{formatBytes(upload.fileSize)}</dd>
                    </div>
                  </dl>
                  {error ? (
                    <p role="alert" className="mt-3 text-sm font-semibold text-red-700">
                      {error}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center">
                  <button
                    type="button"
                    disabled={status !== "available" || isPending}
                    onClick={() => void startTranscription(upload)}
                    className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-amber-300 disabled:opacity-60"
                  >
                    {buttonLabel}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function formatBytes(value?: number): string {
  if (!value) return "Unknown";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
