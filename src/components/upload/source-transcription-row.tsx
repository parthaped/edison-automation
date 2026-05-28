"use client";

import { useEffect, useMemo } from "react";
import type {
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "@/lib/edison/types";
import type { TranscriptionError } from "@/lib/edison/service";

interface SourceTranscriptionRowProps {
  documentPackage: DocumentPackage;
  transcription?: TranscriptionRun;
  metadata?: MetadataExtraction;
  sourceFile?: File;
  errors: TranscriptionError[];
}

export function SourceTranscriptionRow({
  documentPackage,
  transcription,
  metadata,
  sourceFile,
  errors,
}: SourceTranscriptionRowProps) {
  const previewUrl = useObjectUrl(sourceFile);
  const previewKind = useMemo(() => detectPreviewKind(sourceFile), [sourceFile]);

  return (
    <article className="border-t border-border first:border-t-0">
      <div className="grid gap-4 px-5 py-4 md:grid-cols-2">
        <SourcePane
          documentPackage={documentPackage}
          previewUrl={previewUrl}
          previewKind={previewKind}
        />
        <TranscriptionPane
          documentPackage={documentPackage}
          transcription={transcription}
          metadata={metadata}
          errors={errors}
        />
      </div>
    </article>
  );
}

function SourcePane({
  documentPackage,
  previewUrl,
  previewKind,
}: {
  documentPackage: DocumentPackage;
  previewUrl: string | null;
  previewKind: PreviewKind;
}) {
  return (
    <div className="flex flex-col gap-2">
      <header>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Source
        </p>
        <p className="truncate text-[13px] font-medium text-foreground">
          {documentPackage.sourceFile.name}
        </p>
      </header>
      <div className="relative flex min-h-[260px] flex-1 items-center justify-center overflow-hidden rounded-sm border border-border bg-muted/30">
        {previewUrl && previewKind === "image" ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={previewUrl}
            alt={`${documentPackage.sourceFile.name} preview`}
            className="max-h-[360px] max-w-full object-contain"
          />
        ) : previewUrl && previewKind === "pdf" ? (
          <iframe
            src={previewUrl}
            title={`${documentPackage.sourceFile.name} preview`}
            className="h-[360px] w-full"
          />
        ) : (
          <p className="px-4 text-center text-[12px] text-muted-foreground">
            Preview unavailable. Source archived to durable storage.
          </p>
        )}
      </div>
    </div>
  );
}

function TranscriptionPane({
  documentPackage,
  transcription,
  metadata,
  errors,
}: {
  documentPackage: DocumentPackage;
  transcription?: TranscriptionRun;
  metadata?: MetadataExtraction;
  errors: TranscriptionError[];
}) {
  return (
    <div className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Transcription
          </p>
          <p className="font-mono text-[13px] text-foreground">
            {documentPackage.documentId}
          </p>
        </div>
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
          {documentPackage.status.replaceAll("_", " ")} ·{" "}
          {documentPackage.confidence} confidence
        </p>
      </header>
      {metadata ? (
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
          <MetaRow label="Type" value={metadata.documentType} />
          <MetaRow label="Date" value={metadata.date} />
          <MetaRow label="Authors" value={metadata.authors.join("; ")} />
          <MetaRow
            label="Recipients"
            value={metadata.recipients.join("; ")}
          />
        </dl>
      ) : null}
      <pre className="min-h-[180px] flex-1 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-card px-3 py-2 font-mono text-[12px] leading-snug text-foreground">
        {transcription?.diplomaticText ||
          transcription?.ocrText ||
          "Transcription not yet available."}
      </pre>
      {errors.length > 0 ? (
        <ul className="space-y-1 text-[12px] text-rose-600">
          {errors.map((error, index) => (
            <li key={`${error.stage}-${index}`}>
              <span className="font-semibold uppercase tracking-wide">
                {error.stage}:
              </span>{" "}
              {error.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="font-medium text-foreground">{label}</dt>
      <dd>{value || "\u2014"}</dd>
    </>
  );
}

type PreviewKind = "image" | "pdf" | "none";

function detectPreviewKind(file?: File): PreviewKind {
  if (!file) return "none";
  const type = file.type.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  return "none";
}

function useObjectUrl(file?: File): string | null {
  const url = useMemo(
    () => (file ? URL.createObjectURL(file) : null),
    [file],
  );
  useEffect(() => {
    if (!url) return;
    return () => URL.revokeObjectURL(url);
  }, [url]);
  return url;
}
