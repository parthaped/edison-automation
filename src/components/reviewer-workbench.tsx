"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  Save,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ConfidenceBucket,
  DocumentPackage,
  MetadataExtraction,
  ReviewDecision,
  ReviewEvent,
  TranscriptionRun,
} from "@/lib/edison/types";
import { motionSpring } from "@/components/motion-primitives";

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

const confidenceClasses: Record<ConfidenceBucket, string> = {
  high: "border-emerald-200/70 bg-emerald-50/80 text-emerald-700",
  medium: "border-amber-200/70 bg-amber-50/80 text-amber-700",
  low: "border-rose-200/70 bg-rose-50/80 text-rose-700",
  blocked: "border-border bg-muted/70 text-foreground/70",
};

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
      <Card className="surface-elevated border-dashed">
        <CardContent className="py-12 text-center">
          <h2 className="text-2xl font-semibold tracking-[-0.01em]">
            No reviewable documents
          </h2>
          <p className="mt-3 text-muted-foreground">
            New documents will appear here after ingest and extraction complete.
          </p>
        </CardContent>
      </Card>
    );
  }

  const activeImage = activeDocument.pages[activePage];
  const queuePosition = `${activeIndex + 1} of ${documents.length}`;
  const decisionLabel =
    decisions.find((d) => d.value === decision)?.label ?? "Edit transcription";
  const characterCount = editedText.length;

  function goToDocument(index: number) {
    const next = Math.max(0, Math.min(index, documents.length - 1));
    setActiveIndex(next);
    setActivePage(0);
  }

  function handleSave() {
    toast.success("Review action saved", {
      description: `${decisionLabel} \u00b7 ${activeDocument.documentId}`,
    });
  }

  return (
    <section
      aria-labelledby="review-workbench-title"
      className="surface-elevated grid gap-6 rounded-2xl p-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(380px,0.85fr)] lg:p-7"
    >
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700/90">
              Review queue {queuePosition}
            </p>
            <h2
              id="review-workbench-title"
              className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] text-foreground"
            >
              {activeDocument.title}
            </h2>
          </div>
          <div className="flex items-center gap-1.5">
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
        </div>

        <InfoBar document={activeDocument} />

        <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/30">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/60 bg-card/60 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <FileText className="h-4 w-4 text-muted-foreground" strokeWidth={1.5} />
              Source document viewer
            </div>
            {activeDocument.pages.length > 0 ? (
              <Tabs
                value={String(activePage)}
                onValueChange={(value) => setActivePage(Number(value))}
                aria-label="Page navigation"
              >
                <TabsList>
                  {activeDocument.pages.map((page) => (
                    <TabsTrigger
                      key={page.id}
                      value={String(page.pageIndex)}
                    >
                      Page {page.sourcePage}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            ) : null}
          </div>
          <div className="flex min-h-[520px] items-center justify-center p-6 sm:p-10">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${activeDocument.id}-${activePage}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={motionSpring}
                className="w-full max-w-2xl"
              >
                {activeImage ? (
                  <article className="rounded-xl border border-border/70 bg-card p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_1px_2px_rgba(0,0,0,0.04)]">
                    <div className="mb-6 flex items-center justify-between border-b border-border/60 pb-3">
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {activeImage.imageFilename}
                      </span>
                      <Badge variant="outline" className="rounded-full px-2.5">
                        Page {activeImage.sourcePage}
                      </Badge>
                    </div>
                    <div className="space-y-4 text-[17px] leading-8 text-foreground/90">
                      <p>Letterhead: Edison Electric Light Co. of Philadelphia</p>
                      <p>Dateline: Philadelphia, Jan. 12, 1890</p>
                      <p>
                        Body: Mr. Marks reports on the{" "}
                        <span className="rounded-sm bg-amber-100/70 px-1 underline decoration-amber-500/70 decoration-2 underline-offset-[5px]">
                          [filament?]
                        </span>{" "}
                        tests and station materials.
                      </p>
                      <p>Signature: W. D. Marks</p>
                    </div>
                  </article>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-card/70 p-10 text-center">
                    <p className="text-lg font-semibold text-foreground">
                      No extracted pages available.
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      This file is blocked or unsupported and should be handled
                      manually.
                    </p>
                  </div>
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>

      <aside
        className="min-w-0 space-y-5"
        aria-label="Transcription and metadata correction panel"
      >
        <Card className="surface-elevated">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <label
                htmlFor="transcription"
                className="text-base font-semibold tracking-[-0.01em] text-foreground"
              >
                Diplomatic transcription
              </label>
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {characterCount} ch
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              Preserve original spelling, abbreviations, punctuation, annotations,
              and uncertainty marks.
            </p>
          </CardHeader>
          <CardContent>
            <textarea
              id="transcription"
              className="min-h-72 w-full resize-y rounded-xl border border-border/80 bg-card px-4 py-3 font-mono text-[13px] leading-6 text-foreground transition-shadow placeholder:text-muted-foreground/70 focus:border-amber-400/70 focus:outline-none focus:ring-4 focus:ring-amber-300/30"
              value={editedText}
              onChange={(event) => setEditedText(event.target.value)}
              spellCheck={false}
            />
          </CardContent>
        </Card>

        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle className="text-base font-semibold tracking-[-0.01em]">
              Metadata checks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <MetadataRows metadata={metadata} />
          </CardContent>
        </Card>

        <Card className="ring-amber-200/70 bg-amber-50/40">
          <CardHeader>
            <div className="flex items-center gap-2">
              <AlertTriangle
                className="h-4 w-4 text-amber-700"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <CardTitle className="text-base font-semibold tracking-[-0.01em] text-amber-900">
                Uncertainty and cost
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {activeDocument.uncertaintyNotes.length > 0 ? (
              <ul className="space-y-2">
                {activeDocument.uncertaintyNotes.map((note) => (
                  <li
                    key={note}
                    className="flex items-start gap-2 rounded-lg bg-white/80 px-3 py-2 text-sm text-foreground/90 shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
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
              <p className="text-sm text-foreground/70">No uncertainty notes.</p>
            )}
            <p className="mt-3 text-[12px] text-amber-900/80">
              Model: <span className="font-mono">{transcription.model}</span>
              {" \u00b7 "}
              Prompt v{transcription.promptVersion}
              {" \u00b7 "}
              Cost: ${transcription.costUsd?.toFixed(3) ?? "0.000"}
            </p>
          </CardContent>
        </Card>

        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle
              className="text-base font-semibold tracking-[-0.01em]"
            >
              Review action
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <label
                  htmlFor="decision"
                  className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Decision
                </label>
                <div className="mt-1.5">
                  <Select
                    value={decision}
                    onValueChange={(value) =>
                      setDecision(value as ReviewDecision)
                    }
                  >
                    <SelectTrigger
                      id="decision"
                      size="default"
                      className="w-full"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {decisions.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <Button
                type="button"
                size="lg"
                className="w-full gap-2 rounded-xl"
                onClick={handleSave}
              >
                <Save className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
                Save review action
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="surface-elevated">
          <CardHeader>
            <CardTitle className="text-base font-semibold tracking-[-0.01em]">
              Audit trail
            </CardTitle>
          </CardHeader>
          <CardContent>
            {reviewEvents.length > 0 ? (
              <ScrollArea className="max-h-64 pr-2">
                <ol className="space-y-3">
                  {reviewEvents.map((event) => (
                    <li key={event.id} className="relative pl-5">
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-500/80"
                      />
                      <p className="text-sm font-medium text-foreground">
                        {event.decision.replaceAll("_", " ")}
                      </p>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {event.note}
                      </p>
                    </li>
                  ))}
                </ol>
              </ScrollArea>
            ) : (
              <p className="text-sm text-muted-foreground">No reviews yet.</p>
            )}
          </CardContent>
        </Card>
      </aside>
    </section>
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
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.96 }}
      transition={motionSpring}
      className="inline-flex h-8 items-center gap-1 rounded-full border border-border/80 bg-card px-3 text-[13px] font-medium text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-40"
    >
      {isPrev ? (
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      ) : null}
      {isPrev ? "Previous" : "Next"}
      {!isPrev ? (
        <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      ) : null}
    </motion.button>
  );
}

function InfoBar({ document }: { document: DocumentPackage }) {
  const statusLabel = document.status.replaceAll("_", " ");
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-border/70 bg-border/70 sm:grid-cols-2 lg:grid-cols-4">
      <InfoCell label="Folder ID" value={document.folderId} mono />
      <InfoCell label="Document ID" value={document.documentId} mono />
      <InfoCell
        label="Confidence"
        valueNode={
          <span
            className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${
              confidenceClasses[document.confidence]
            }`}
          >
            {document.confidence === "high" ? (
              <CheckCircle2 className="mr-1 h-3 w-3" strokeWidth={2} />
            ) : null}
            {document.confidence}
          </span>
        }
      />
      <InfoCell
        label="Status"
        valueNode={
          <span className="inline-flex h-6 items-center rounded-full border border-border bg-card px-2.5 text-[11px] font-medium capitalize tracking-wide text-foreground">
            {statusLabel}
          </span>
        }
      />
    </div>
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
    <div className="bg-card px-4 py-3.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-1.5">
        {valueNode ?? (
          <span
            className={`break-words text-sm font-medium text-foreground ${
              mono ? "font-mono" : ""
            }`}
          >
            {value}
          </span>
        )}
      </div>
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
    <dl className="space-y-3 text-sm">
      {rows.map((row, idx) => (
        <div key={row.label}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {row.label}
            </dt>
            <dd className="text-right font-medium text-foreground">
              {row.value || (
                <span className="text-muted-foreground/70">—</span>
              )}
            </dd>
          </div>
          {idx < rows.length - 1 ? (
            <Separator className="mt-3 bg-border/70" />
          ) : null}
        </div>
      ))}
    </dl>
  );
}
