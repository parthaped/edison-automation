"use client";

import { useState } from "react";
import type {
  DocumentPackage,
  MetadataExtraction,
  ReviewDecision,
  ReviewEvent,
  TranscriptionRun,
} from "@/lib/edison/types";

interface ReviewerWorkbenchProps {
  documents: DocumentPackage[];
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
  reviewEvents: ReviewEvent[];
}

const decisions: Array<{ value: ReviewDecision; label: string }> = [
  { value: "edited_transcription", label: "Edit transcription" },
  { value: "marked_uncertain", label: "Mark uncertain word" },
  { value: "corrected_metadata", label: "Correct metadata" },
  { value: "flagged_manual_review", label: "Flag manual review" },
  { value: "approved", label: "Approve" },
  { value: "rejected", label: "Reject" },
];

export function ReviewerWorkbench({
  documents,
  transcription,
  metadata,
  reviewEvents,
}: ReviewerWorkbenchProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [activePage, setActivePage] = useState(0);
  const [editedText, setEditedText] = useState(transcription.diplomaticText);
  const [decision, setDecision] = useState<ReviewDecision>("edited_transcription");
  const activeDocument = documents[activeIndex] ?? documents[0];
  if (!activeDocument) {
    return (
      <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h2 className="text-2xl font-semibold text-slate-950">No reviewable documents</h2>
        <p className="mt-3 text-slate-600">
          New documents will appear here after ingest and extraction complete.
        </p>
      </section>
    );
  }

  const activeImage = activeDocument.pages[activePage];
  const queuePosition = `${activeIndex + 1} of ${documents.length}`;

  function goToDocument(index: number) {
    setActiveIndex(Math.max(0, Math.min(index, documents.length - 1)));
    setActivePage(0);
  }

  return (
    <section
      aria-labelledby="review-workbench-title"
      className="grid gap-6 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm lg:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)] lg:p-6"
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Review queue {queuePosition}
            </p>
            <h2 id="review-workbench-title" className="text-2xl font-semibold text-slate-950">
              {activeDocument.title}
            </h2>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-amber-300 disabled:opacity-40"
              onClick={() => goToDocument(activeIndex - 1)}
              disabled={activeIndex === 0}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-100 focus:outline-none focus:ring-4 focus:ring-amber-300 disabled:opacity-40"
              onClick={() => goToDocument(activeIndex + 1)}
              disabled={activeIndex === documents.length - 1}
            >
              Next
            </button>
          </div>
        </div>

        <div className="grid gap-3 rounded-2xl bg-slate-950 p-4 text-white md:grid-cols-4">
          <Info label="Folder ID" value={activeDocument.folderId} />
          <Info label="Document ID" value={activeDocument.documentId} />
          <Info label="Confidence" value={activeDocument.confidence} />
          <Info label="Status" value={activeDocument.status.replaceAll("_", " ")} />
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <p className="font-semibold text-slate-900">Source document viewer</p>
            <div className="flex gap-2" aria-label="Page navigation">
              {activeDocument.pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  className={`rounded-full px-3 py-1 text-sm font-semibold focus:outline-none focus:ring-4 focus:ring-amber-300 ${
                    page.pageIndex === activePage
                      ? "bg-amber-400 text-slate-950"
                      : "bg-slate-200 text-slate-800 hover:bg-slate-300"
                  }`}
                  onClick={() => setActivePage(page.pageIndex)}
                >
                  Page {page.sourcePage}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-h-[520px] items-center justify-center p-6">
            {activeImage ? (
              <div className="w-full max-w-2xl rounded-xl border border-slate-300 bg-white p-8 shadow-inner">
                <div className="mb-6 flex items-center justify-between border-b border-slate-200 pb-3">
                  <span className="font-mono text-sm text-slate-600">
                    {activeImage.imageFilename}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-700">
                    Page {activeImage.sourcePage}
                  </span>
                </div>
                <div className="space-y-4 text-lg leading-8 text-slate-800">
                  <p>Letterhead: Edison Electric Light Co. of Philadelphia</p>
                  <p>Dateline: Philadelphia, Jan. 12, 1890</p>
                  <p>
                    Body: Mr. Marks reports on the{" "}
                    <mark className="rounded bg-amber-200 px-1">[filament?]</mark>{" "}
                    tests and station materials.
                  </p>
                  <p>Signature: W. D. Marks</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-400 bg-white p-8 text-center">
                <p className="text-lg font-semibold text-slate-950">No extracted pages available.</p>
                <p className="mt-2 text-slate-600">
                  This file is blocked or unsupported and should be handled manually.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4" aria-label="Transcription and metadata correction panel">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <label htmlFor="transcription" className="text-lg font-semibold text-slate-950">
            Diplomatic transcription
          </label>
          <p className="mt-1 text-sm text-slate-600">
            Preserve original spelling, abbreviations, punctuation, annotations, and uncertainty marks.
          </p>
          <textarea
            id="transcription"
            className="mt-4 min-h-72 w-full rounded-xl border border-slate-300 bg-white p-4 font-mono text-sm leading-6 text-slate-950 focus:border-slate-950 focus:outline-none focus:ring-4 focus:ring-amber-300"
            value={editedText}
            onChange={(event) => setEditedText(event.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-lg font-semibold text-slate-950">Metadata checks</h3>
          <dl className="mt-4 grid gap-3 text-sm">
            <Info label="Date" value={metadata.date} dark={false} />
            <Info label="Document type" value={metadata.documentType} dark={false} />
            <Info label="Authors" value={metadata.authors.join("; ")} dark={false} />
            <Info label="Recipients" value={metadata.recipients.join("; ")} dark={false} />
            <Info label="Subjects" value={metadata.subjects.join("; ")} dark={false} />
          </dl>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-lg font-semibold text-slate-950">Uncertainty and cost</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-800">
            {activeDocument.uncertaintyNotes.map((note) => (
              <li key={note} className="rounded-lg bg-white px-3 py-2">
                {note}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-slate-700">
            Model: {transcription.model} · Prompt v{transcription.promptVersion} · Cost: $
            {transcription.costUsd?.toFixed(3) ?? "0.000"}
          </p>
        </div>

        <form className="rounded-2xl border border-slate-200 bg-white p-4">
          <label htmlFor="decision" className="text-lg font-semibold text-slate-950">
            Review action
          </label>
          <select
            id="decision"
            className="mt-3 w-full rounded-xl border border-slate-300 bg-white p-3 text-slate-950 focus:border-slate-950 focus:outline-none focus:ring-4 focus:ring-amber-300"
            value={decision}
            onChange={(event) => setDecision(event.target.value as ReviewDecision)}
          >
            {decisions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-3 font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-amber-300"
          >
            Save review action
          </button>
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <h3 className="text-lg font-semibold text-slate-950">Audit trail</h3>
          <ol className="mt-3 space-y-3">
            {reviewEvents.map((event) => (
              <li key={event.id} className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                <strong className="block text-slate-950">{event.decision.replaceAll("_", " ")}</strong>
                {event.note}
              </li>
            ))}
          </ol>
        </div>
      </aside>
    </section>
  );
}

function Info({
  label,
  value,
  dark = true,
}: {
  label: string;
  value: string;
  dark?: boolean;
}) {
  return (
    <div>
      <dt className={`text-xs font-semibold uppercase tracking-wide ${dark ? "text-slate-300" : "text-slate-500"}`}>
        {label}
      </dt>
      <dd className={`mt-1 break-words font-semibold ${dark ? "text-white" : "text-slate-950"}`}>
        {value}
      </dd>
    </div>
  );
}
