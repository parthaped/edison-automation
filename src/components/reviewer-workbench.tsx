"use client";

import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DocumentViewer } from "@/components/document-viewer";
import { Button } from "@/components/ui/button";
import {
  buildFileNavUnits,
  fileIndexForDocument,
  leadDocumentIdForFileIndex,
} from "@/lib/edison/review-navigation";
import { formatGloc } from "@/lib/edison/metadata-normalize";
import { checkSplitRules } from "@/lib/edison/split-validation";
import type {
  ConfidenceBucket,
  DocumentPackage,
  MetadataExtraction,
  SourceGroup,
  TranscriptionRun,
} from "@/lib/edison/types";

interface ReviewerWorkbenchProps {
  documents: DocumentPackage[];
  transcriptions: Record<string, TranscriptionRun>;
  metadata: Record<string, MetadataExtraction>;
  initialDocumentId?: string;
}

const confidenceDot: Record<ConfidenceBucket, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-rose-500",
  blocked: "bg-slate-400",
};

function emptyTranscription(documentId: string): TranscriptionRun {
  return {
    id: `${documentId}-pending-transcription`,
    documentId,
    model: "not-run",
    promptVersion: "not-run",
    ocrText: "",
    diplomaticText: "",
    uncertainReadings: [],
  };
}

function emptyMetadata(document: DocumentPackage): MetadataExtraction {
  return {
    folderId: document.folderId,
    documentId: document.documentId,
    title: document.title,
    documentType: "",
    date: "",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
    places: [],
    imageNames: document.pages.map((page) => page.imageFilename),
    confidence: document.confidence,
  };
}

export function ReviewerWorkbench({
  documents: initialDocuments,
  transcriptions,
  metadata,
  initialDocumentId,
}: ReviewerWorkbenchProps) {
  const router = useRouter();
  // The list of documents the reviewer is working through. We lift it to
  // state so approve/remove can shrink the queue without waiting for a
  // round-trip to the server, and Next can be advanced to the next file
  // immediately. Server-side data still drives the *initial* set.
  const [documents, setDocuments] = useState<DocumentPackage[]>(initialDocuments);
  const [prevInitialDocuments, setPrevInitialDocuments] =
    useState<DocumentPackage[]>(initialDocuments);
  if (initialDocuments !== prevInitialDocuments) {
    // React 19 derived-state pattern: re-sync local queue when the server
    // hands us a new prop reference (e.g. after router.refresh()).
    setPrevInitialDocuments(initialDocuments);
    setDocuments(initialDocuments);
  }

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    initialDocumentId ?? null,
  );
  const [prevInitialDocumentId, setPrevInitialDocumentId] = useState<
    string | undefined
  >(initialDocumentId);
  if (initialDocumentId !== prevInitialDocumentId) {
    setPrevInitialDocumentId(initialDocumentId);
    if (initialDocumentId) setSelectedDocumentId(initialDocumentId);
  }

  const [approving, setApproving] = useState(false);
  const [deleteConfirmingForId, setDeleteConfirmingForId] = useState<
    string | null
  >(null);
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [savingComments, setSavingComments] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [renamingFolder, setRenamingFolder] = useState(false);
  const [folderDraft, setFolderDraft] = useState<string | null>(null);

  const fileNavUnits = useMemo(
    () => buildFileNavUnits(documents),
    [documents],
  );

  const activeIndex = Math.max(
    0,
    documents.findIndex((doc) => doc.documentId === selectedDocumentId),
  );
  const activeDocument = documents[activeIndex] ?? documents[0];

  const deleteConfirming =
    deleteConfirmingForId === activeDocument?.documentId;

  if (!activeDocument) {
    return (
      <div className="border border-dashed border-border bg-card px-6 py-12 text-center">
        <h3 className="text-lg font-semibold text-foreground">
          No documents to review
        </h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Approved documents move to the{" "}
          <Link href="/workbench/past" className="underline">
            Past verifications
          </Link>{" "}
          tab. New uploads will appear here after ingest completes.
        </p>
      </div>
    );
  }

  const activeFileIndex = fileIndexForDocument(
    fileNavUnits,
    activeDocument.documentId,
  );
  const queuePosition = `${activeFileIndex + 1} of ${fileNavUnits.length}`;
  const transcription =
    transcriptions[activeDocument.documentId] ??
    emptyTranscription(activeDocument.documentId);
  const activeMetadata =
    metadata[activeDocument.documentId] ?? emptyMetadata(activeDocument);
  const commentsDraft =
    commentDrafts[activeDocument.documentId] ??
    activeMetadata.comments ??
    "";

  function goToFile(fileIndex: number) {
    const leadId = leadDocumentIdForFileIndex(fileNavUnits, fileIndex);
    if (!leadId) return;
    setSelectedDocumentId(leadId);
    router.push(`/workbench/review?doc=${encodeURIComponent(leadId)}`);
  }

  const isBlocked = activeDocument.status === "blocked";
  const effectiveStatus = activeDocument.status;

  // Drops every sibling that belongs to the same source file as
  // `documentId` from the local queue, so approving one sibling clears the
  // whole file from review at once (the user is moved on to the next file).
  function removeFileFromQueue(documentId: string) {
    const target = documents.find((doc) => doc.documentId === documentId);
    const groupId = target?.sourceGroup?.groupId;
    setDocuments((current) =>
      current.filter((doc) => {
        if (doc.documentId === documentId) return false;
        if (groupId && doc.sourceGroup?.groupId === groupId) return false;
        return true;
      }),
    );
  }

  async function handleApprove() {
    if (approving || isBlocked) return;
    setApproving(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(activeDocument.documentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "approved" }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          data?.error?.message ?? `Approval failed (${response.status}).`,
        );
      }
      toast.success("Document approved · moved to Past verifications.");
      const nextFileLeadId = leadDocumentIdForFileIndex(
        fileNavUnits,
        activeFileIndex + 1,
      );
      const approvedDocumentId = activeDocument.documentId;
      removeFileFromQueue(approvedDocumentId);
      if (nextFileLeadId) {
        setSelectedDocumentId(nextFileLeadId);
        router.push(`/workbench/review?doc=${encodeURIComponent(nextFileLeadId)}`);
      } else {
        setSelectedDocumentId(null);
        router.push("/workbench/review");
      }
      // Refresh so the dashboard counts and the paginated review window
      // reload with the new state (e.g. next page of documents fills in).
      router.refresh();
    } catch (error) {
      toast.error("Could not approve document", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setApproving(false);
    }
  }

  async function handleSaveFolderId() {
    const target = folderDraft?.trim();
    if (!target || target === activeDocument.folderId) {
      setFolderDraft(null);
      return;
    }
    setRenamingFolder(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(activeDocument.documentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: target }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          data?.error?.message ?? `Rename failed (${response.status}).`,
        );
      }
      const body = (await response.json()) as {
        document: DocumentPackage;
      };
      const newDocumentId = body.document.documentId;
      toast.success(`Folder renamed · ${activeDocument.folderId} → ${body.document.folderId}`);
      setFolderDraft(null);
      setSelectedDocumentId(newDocumentId);
      router.push(`/workbench/review?doc=${encodeURIComponent(newDocumentId)}`);
      router.refresh();
    } catch (error) {
      toast.error("Could not rename folder", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setRenamingFolder(false);
    }
  }

  async function handleSaveComments() {
    if (savingComments) return;
    setSavingComments(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(activeDocument.documentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comments: commentsDraft }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          data?.error?.message ?? `Save failed (${response.status}).`,
        );
      }
      setCommentDrafts((prev) => {
        const next = { ...prev };
        delete next[activeDocument.documentId];
        return next;
      });
      toast.success("Comments saved.");
      router.refresh();
    } catch (error) {
      toast.error("Could not save comments", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSavingComments(false);
    }
  }

  async function handleDelete() {
    if (deleting) return;
    if (!deleteConfirming) {
      setDeleteConfirmingForId(activeDocument.documentId);
      return;
    }

    setDeleting(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(activeDocument.documentId)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          data?.error?.message ?? `Delete failed (${response.status}).`,
        );
      }

      toast.success("Document removed from review.");
      const remaining = documents.filter(
        (document) => document.documentId !== activeDocument.documentId,
      );
      setDocuments(remaining);
      setDeleteConfirmingForId(null);
      if (remaining.length === 0) {
        setSelectedDocumentId(null);
        router.push("/workbench/review");
      } else {
        const nextIndex = Math.min(activeIndex, remaining.length - 1);
        const nextId = remaining[nextIndex].documentId;
        setSelectedDocumentId(nextId);
        router.push(`/workbench/review?doc=${encodeURIComponent(nextId)}`);
      }
      router.refresh();
    } catch (error) {
      toast.error("Could not delete document", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeleting(false);
    }
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
          {activeDocument.sourceGroup ? (
            <SiblingsChip
              group={activeDocument.sourceGroup}
              currentDocumentId={activeDocument.documentId}
            />
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {deleteConfirming ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-2 py-1">
              <span className="text-[12px] font-medium text-rose-900">
                Remove this file from review?
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDeleteConfirmingForId(null)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleDelete}
                disabled={deleting}
              >
                {deleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                )}
                {deleting ? "Removing…" : "Confirm remove"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDelete}
              disabled={deleting || approving}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              Remove
            </Button>
          )}
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
          <Button
            type="button"
            size="sm"
            onClick={handleApprove}
            disabled={approving || isBlocked}
          >
            <Check className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
            {approving ? "Approving…" : "Approve & next"}
          </Button>
          <NavButton
            direction="prev"
            onClick={() => goToFile(activeFileIndex - 1)}
            disabled={activeFileIndex <= 0}
          />
          <NavButton
            direction="next"
            onClick={() => goToFile(activeFileIndex + 1)}
            disabled={activeFileIndex >= fileNavUnits.length - 1}
          />
        </div>
      </header>

      <div className="border-b border-border px-5 py-4">
        <InfoBar
          document={activeDocument}
          status={effectiveStatus}
          folderDraft={folderDraft}
          renamingFolder={renamingFolder}
          onFolderDraftChange={setFolderDraft}
          onSaveFolder={handleSaveFolderId}
        />
      </div>

      <div className="border-b border-border bg-muted/40 p-3">
        <div className="h-[72vh] min-h-[560px]">
          <DocumentViewer
            document={activeDocument}
            transcription={transcription}
            className="h-full"
          />
        </div>
      </div>

      {activeDocument.sourceGroup ? (
        <SplitGroupPanel
          group={activeDocument.sourceGroup}
          onSaved={() => router.refresh()}
        />
      ) : null}

      <div className="grid gap-0 md:grid-cols-2 md:divide-x md:divide-border">
        <div className="border-b border-border md:border-b-0">
          <PanelHeading>Metadata checks</PanelHeading>
          <div className="px-5 py-4">
            <MetadataRows
              metadata={activeMetadata}
              commentsDraft={commentsDraft}
              onCommentsChange={(value) =>
                setCommentDrafts((prev) => ({
                  ...prev,
                  [activeDocument.documentId]: value,
                }))
              }
              onCommentsSave={handleSaveComments}
              savingComments={savingComments}
            />
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

function InfoBar({
  document,
  status,
  folderDraft,
  renamingFolder,
  onFolderDraftChange,
  onSaveFolder,
}: {
  document: DocumentPackage;
  status: DocumentPackage["status"];
  folderDraft: string | null;
  renamingFolder: boolean;
  onFolderDraftChange: (value: string | null) => void;
  onSaveFolder: () => void;
}) {
  const statusLabel = status.replaceAll("_", " ");
  const editing = folderDraft !== null;
  return (
    <dl className="grid grid-cols-2 gap-y-3 text-sm md:grid-cols-4 md:gap-y-0 md:divide-x md:divide-border">
      <InfoCell
        label="Folder ID"
        valueNode={
          editing ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSaveFolder();
              }}
              className="flex items-center gap-1"
            >
              <input
                type="text"
                value={folderDraft}
                onChange={(event) => onFolderDraftChange(event.target.value)}
                aria-label="Folder ID"
                placeholder="E2002"
                disabled={renamingFolder}
                autoFocus
                className="h-7 w-28 rounded-sm border border-border bg-background px-2 font-mono text-sm text-foreground"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                disabled={renamingFolder || folderDraft.trim().length === 0}
              >
                {renamingFolder ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Check className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                )}
                Save
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onFolderDraftChange(null)}
                disabled={renamingFolder}
                aria-label="Cancel rename"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              </Button>
            </form>
          ) : (
            <span className="inline-flex items-center gap-1">
              <span className="break-words font-mono text-sm font-medium text-foreground">
                {document.folderId}
              </span>
              <button
                type="button"
                onClick={() => onFolderDraftChange(document.folderId)}
                aria-label="Edit folder ID"
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Pencil
                  className="h-3 w-3"
                  strokeWidth={1.8}
                  aria-hidden="true"
                />
              </button>
            </span>
          )
        }
      />
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

function MetadataRows({
  metadata,
  commentsDraft,
  onCommentsChange,
  onCommentsSave,
  savingComments,
}: {
  metadata: MetadataExtraction;
  commentsDraft: string;
  onCommentsChange: (value: string) => void;
  onCommentsSave: () => void;
  savingComments: boolean;
}) {
  const rows = useMemo(
    () => [
      { label: "GLOC", value: formatGloc(metadata.folderId) },
      { label: "Doc ID", value: metadata.documentId },
      { label: "Document type", value: metadata.documentType },
      { label: "Date", value: metadata.date },
      { label: "Authors", value: metadata.authors.join("; ") },
      { label: "Recipients", value: metadata.recipients.join("; ") },
      {
        label: "Name(s) mentioned",
        value: metadata.mentionedNames.join("; "),
      },
      { label: "Subjects", value: metadata.subjects.join("; ") },
      { label: "Places", value: metadata.places.join("; ") },
    ],
    [metadata],
  );

  return (
    <div className="space-y-4">
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
      <div className="border-t border-border pt-3">
        <label
          htmlFor="metadata-comments"
          className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
        >
          Comments
        </label>
        <textarea
          id="metadata-comments"
          value={commentsDraft}
          onChange={(event) => onCommentsChange(event.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder="Indexer notes (marginalia, attachments, conjectures)"
        />
        <div className="mt-2 flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={onCommentsSave}
            disabled={savingComments}
          >
            {savingComments ? (
              <>
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              "Save comments"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SiblingsChip({
  group,
  currentDocumentId,
}: {
  group: SourceGroup;
  currentDocumentId: string;
}) {
  if (group.siblingIds.length <= 1) {
    return (
      <p className="mt-2 text-[12px] text-muted-foreground">
        From{" "}
        <span className="font-mono text-foreground">
          {group.originalFileName}
        </span>{" "}
        (single document, {group.totalPages} page
        {group.totalPages === 1 ? "" : "s"})
      </p>
    );
  }
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
      <span>
        From{" "}
        <span className="font-mono text-foreground">
          {group.originalFileName}
        </span>{" "}
        · Sibling {group.position + 1} of {group.siblingIds.length}:
      </span>
      <div className="inline-flex flex-wrap items-center gap-1">
        {group.siblingIds.map((id, index) => {
          const isActive = id === currentDocumentId;
          return (
            <Link
              key={id}
              href={`/workbench/review?doc=${encodeURIComponent(id)}`}
              prefetch={false}
              aria-current={isActive ? "page" : undefined}
              className={
                isActive
                  ? "inline-flex items-center rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-foreground"
                  : "inline-flex items-center rounded-sm border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-foreground transition-colors hover:bg-muted"
              }
            >
              {index + 1}. {id}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

interface SplitDraft {
  id: string;
  startPage: number;
  endPage: number;
  title: string;
}

function makeDraftId(): string {
  return `split-${Math.random().toString(36).slice(2, 9)}`;
}

function SplitGroupPanel({
  group,
  onSaved,
}: {
  group: SourceGroup;
  onSaved: () => void;
}) {
  const [drafts, setDrafts] = useState<SplitDraft[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const loading = open && !loaded && !loadError;

  useEffect(() => {
    // Lazy-load the real sibling page ranges the first time the panel opens.
    // We avoid fetching on mount because most documents are single-document
    // groups where the panel never expands. State updates happen only inside
    // promise callbacks (never synchronously in the effect body) so we don't
    // trip the react-hooks/set-state-in-effect lint.
    if (!open || loaded) return;
    const controller = new AbortController();
    fetch(
      `/api/documents/group/${encodeURIComponent(group.groupId)}/splits`,
      { method: "GET", signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          throw new Error(
            data?.error?.message ?? `Load failed (${response.status}).`,
          );
        }
        return response.json() as Promise<{
          siblings: Array<{
            documentId: string;
            startPage: number;
            endPage: number;
            title: string;
          }>;
        }>;
      })
      .then((data) => {
        setDrafts(
          data.siblings.map((sib) => ({
            id: makeDraftId(),
            startPage: sib.startPage,
            endPage: sib.endPage,
            title: sib.title ?? "",
          })),
        );
        setLoaded(true);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      controller.abort();
    };
  }, [open, loaded, group.groupId]);

  function updateDraft(index: number, patch: Partial<SplitDraft>) {
    setDrafts((current) =>
      current.map((draft, i) =>
        i === index ? { ...draft, ...patch } : draft,
      ),
    );
  }

  function addSplit() {
    setDrafts((current) => {
      if (current.length === 0) {
        return [
          {
            id: makeDraftId(),
            startPage: 1,
            endPage: group.totalPages,
            title: "",
          },
        ];
      }
      const last = current[current.length - 1];
      if (last.endPage >= group.totalPages) {
        toast.info("All pages are already assigned.");
        return current;
      }
      return [
        ...current,
        {
          id: makeDraftId(),
          startPage: last.endPage + 1,
          endPage: group.totalPages,
          title: "",
        },
      ];
    });
  }

  function removeSplit(index: number) {
    setDrafts((current) => {
      if (current.length <= 1) {
        toast.info("Keep at least one split — every page must belong to a document.");
        return current;
      }
      return current.filter((_, i) => i !== index);
    });
  }

  const validation = checkSplitRules(drafts, group.totalPages);

  async function handleSave() {
    if (validation.errorMessage) {
      toast.error("Cannot save splits", { description: validation.errorMessage });
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(
        `/api/documents/group/${encodeURIComponent(group.groupId)}/splits`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            splits: drafts.map((draft) => ({
              startPage: draft.startPage,
              endPage: draft.endPage,
              title: draft.title.trim() || undefined,
            })),
          }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          data?.error?.message ?? `Save failed (${response.status}).`,
        );
      }
      toast.success("Splits saved. Re-running review.");
      onSaved();
    } catch (error) {
      toast.error("Could not save splits", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border-b border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-5 py-3 text-left text-[12px] font-semibold uppercase tracking-wide text-muted-foreground transition-colors hover:bg-muted/60"
      >
        <span className="inline-flex items-center gap-2">
          <Scissors className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Document splits · {drafts.length} sub-document
          {drafts.length === 1 ? "" : "s"} in {group.originalFileName}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground">
          {open ? "Hide" : "Edit"}
        </span>
      </button>
      {open ? (
        <div className="space-y-3 px-5 pb-4">
          <p className="text-[12px] text-muted-foreground">
            Define page ranges below. Every page from 1 to {group.totalPages}{" "}
            must belong to exactly one split. Editing a range marks that
            sub-document for re-review.
          </p>
          {loading ? (
            <p className="text-[12px] text-muted-foreground">
              Loading current splits…
            </p>
          ) : null}
          {loadError ? (
            <p className="text-[12px] text-rose-600">{loadError}</p>
          ) : null}
          <ul className="space-y-2">
            {drafts.map((draft, index) => {
              const issue = validation.perRow[index];
              return (
                <li
                  key={draft.id}
                  className={`grid gap-2 rounded-md border bg-background px-3 py-2 md:grid-cols-[60px_140px_minmax(0,1fr)_auto] md:items-center ${issue ? "border-rose-400" : "border-border"}`}
                >
                  <span className="text-[12px] font-mono text-muted-foreground">
                    #{index + 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={group.totalPages}
                      value={draft.startPage}
                      onChange={(event) =>
                        updateDraft(index, {
                          startPage: Number.parseInt(event.target.value, 10) || 0,
                        })
                      }
                      aria-label={`Split ${index + 1} start page`}
                      className="h-7 w-14 rounded-sm border border-border bg-background px-1 text-center font-mono text-[12px] text-foreground"
                    />
                    <span className="text-[11px] text-muted-foreground">to</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={group.totalPages}
                      value={draft.endPage}
                      onChange={(event) =>
                        updateDraft(index, {
                          endPage: Number.parseInt(event.target.value, 10) || 0,
                        })
                      }
                      aria-label={`Split ${index + 1} end page`}
                      className="h-7 w-14 rounded-sm border border-border bg-background px-1 text-center font-mono text-[12px] text-foreground"
                    />
                  </div>
                  <input
                    type="text"
                    value={draft.title}
                    onChange={(event) =>
                      updateDraft(index, { title: event.target.value })
                    }
                    placeholder="Optional title (e.g. Marks to Edison)"
                    aria-label={`Split ${index + 1} title`}
                    className="h-7 w-full rounded-sm border border-border bg-background px-2 text-[12px] text-foreground"
                  />
                  <button
                    type="button"
                    onClick={() => removeSplit(index)}
                    aria-label={`Remove split ${index + 1}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-40"
                    disabled={drafts.length <= 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
                  </button>
                  {issue ? (
                    <p className="md:col-span-4 text-[11px] text-rose-600">{issue}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {validation.errorMessage ? (
            <p className="text-[12px] text-rose-600">{validation.errorMessage}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addSplit}
              disabled={saving}
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              Add split
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || Boolean(validation.errorMessage)}
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
              )}
              Save splits
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

