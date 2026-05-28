"use client";

import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DocumentViewer } from "@/components/document-viewer";
import { Button } from "@/components/ui/button";
import type {
  ConfidenceBucket,
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "@/lib/edison/types";

interface ReviewerWorkbenchProps {
  documents: DocumentPackage[];
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
}

const confidenceDot: Record<ConfidenceBucket, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-rose-500",
  blocked: "bg-slate-400",
};

export function ReviewerWorkbench({
  documents,
  transcription,
  metadata,
}: ReviewerWorkbenchProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const activeDocument = documents[activeIndex] ?? documents[0];

  if (!activeDocument) {
    return (
      <div className="border border-dashed border-border bg-card px-6 py-12 text-center">
        <h3 className="text-lg font-semibold text-foreground">
          No reviewable documents
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          New documents will appear here after ingest and extraction complete.
        </p>
      </div>
    );
  }

  const queuePosition = `${activeIndex + 1} of ${documents.length}`;

  function goToDocument(index: number) {
    const next = Math.max(0, Math.min(index, documents.length - 1));
    setActiveIndex(next);
  }

  return (
    <section
      aria-labelledby="review-workbench-title"
      className="border border-border bg-card"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Review queue · Record {queuePosition}
          </p>
          <h2
            id="review-workbench-title"
            className="mt-1 truncate text-[18px] font-semibold text-foreground"
          >
            {activeDocument.title}
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            render={
              <Link
                href={`/viewer/${activeDocument.documentId}`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            Open standalone
          </Button>
          <NavButton
            direction="prev"
            onClick={() => goToDocument(activeIndex - 1)}
            disabled={activeIndex === 0}
          />
          <NavButton
            direction="next"
            onClick={() => goToDocument(activeIndex + 1)}
            disabled={activeIndex === documents.length - 1}
          />
        </div>
      </header>

      <div className="border-b border-border px-5 py-4">
        <InfoBar document={activeDocument} />
      </div>

      <div className="border-b border-border bg-muted/40 p-3">
        <DocumentViewer document={activeDocument} transcription={transcription} />
      </div>

      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border">
        <div className="border-b border-border md:border-b-0">
          <PanelHeading>Metadata checks</PanelHeading>
          <div className="px-5 py-4">
            <MetadataRows metadata={metadata} />
          </div>
        </div>

        <div className="border-l-[3px] border-l-amber-500">
          <PanelHeading>
            <span className="inline-flex items-center gap-1.5">
              <AlertTriangle
                className="h-3.5 w-3.5 text-amber-600"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              Uncertainty and cost
            </span>
          </PanelHeading>
          <div className="px-5 py-4">
            {activeDocument.uncertaintyNotes.length > 0 ? (
              <ul className="divide-y divide-border text-sm">
                {activeDocument.uncertaintyNotes.map((note) => (
                  <li
                    key={note}
                    className="flex items-start gap-2 py-2 text-foreground"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                    />
                    <span className="leading-snug">{note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No uncertainty notes.</p>
            )}
            <p className="mt-3 text-[12px] text-muted-foreground">
              Model: <span className="font-mono text-foreground">{transcription.model}</span>
              {" \u00b7 "}
              Prompt v{transcription.promptVersion}
              {" \u00b7 "}
              Cost: ${transcription.costUsd?.toFixed(3) ?? "0.000"}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border bg-muted/60 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function NavButton({
  direction,
  onClick,
  disabled,
}: {
  direction: "prev" | "next";
  onClick: () => void;
  disabled: boolean;
}) {
  const isPrev = direction === "prev";
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
    >
      {isPrev ? (
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      ) : null}
      {isPrev ? "Previous" : "Next"}
      {!isPrev ? (
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      ) : null}
    </Button>
  );
}

function InfoBar({ document }: { document: DocumentPackage }) {
  const statusLabel = document.status.replaceAll("_", " ");
  return (
    <dl className="grid grid-cols-2 gap-y-3 text-sm md:grid-cols-4 md:gap-y-0 md:divide-x md:divide-border">
      <InfoCell label="Folder ID" value={document.folderId} mono />
      <InfoCell label="Document ID" value={document.documentId} mono />
      <InfoCell
        label="Confidence"
        valueNode={
          <span className="inline-flex items-center gap-1.5 text-sm capitalize text-foreground">
            <span
              aria-hidden="true"
              className={`inline-block h-1.5 w-1.5 rounded-full ${confidenceDot[document.confidence]}`}
            />
            {document.confidence}
          </span>
        }
      />
      <InfoCell
        label="Status"
        valueNode={
          <span className="text-sm capitalize text-foreground">{statusLabel}</span>
        }
      />
    </dl>
  );
}

function InfoCell({
  label,
  value,
  valueNode,
  mono = false,
}: {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="md:px-4 md:first:pl-0 md:last:pr-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1">
        {valueNode ?? (
          <span
            className={`break-words text-sm font-medium text-foreground ${
              mono ? "font-mono" : ""
            }`}
          >
            {value}
          </span>
        )}
      </dd>
    </div>
  );
}

function MetadataRows({ metadata }: { metadata: MetadataExtraction }) {
  const rows = useMemo(
    () => [
      { label: "Date", value: metadata.date },
      { label: "Document type", value: metadata.documentType },
      { label: "Authors", value: metadata.authors.join("; ") },
      { label: "Recipients", value: metadata.recipients.join("; ") },
      { label: "Subjects", value: metadata.subjects.join("; ") },
    ],
    [metadata],
  );

  return (
    <table className="w-full border-collapse text-sm">
      <tbody>
        {rows.map((row) => (
          <tr key={row.label} className="border-t border-border first:border-t-0">
            <th
              scope="row"
              className="w-[35%] py-2 pr-3 text-left align-top text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {row.label}
            </th>
            <td className="py-2 text-right align-top font-medium text-foreground">
              {row.value || (
                <span className="text-muted-foreground/70">—</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
