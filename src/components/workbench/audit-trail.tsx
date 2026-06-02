"use client";

import {
  Check,
  ChevronDown,
  FileInput,
  FilePen,
  FileText,
  FolderInput,
  Gauge,
  History,
  MessageSquare,
  RotateCcw,
  ScanText,
  Scissors,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { AuditEvent, AuditEventType } from "@/lib/edison/audit-log";
import { cn } from "@/lib/utils";

const typeIcon: Record<AuditEventType, typeof FileInput> = {
  ingest_started: History,
  file_ingested: FileInput,
  file_transcribed: ScanText,
  file_graded: Gauge,
  text_edited: FilePen,
  comments_edited: MessageSquare,
  approved: Check,
  unapproved: RotateCcw,
  splits_changed: Scissors,
  folder_renamed: FolderInput,
  deleted: Trash2,
};

const typeLabel: Record<AuditEventType, string> = {
  ingest_started: "Batch started",
  file_ingested: "File ingested",
  file_transcribed: "Transcribed",
  file_graded: "Confidence graded",
  text_edited: "Transcription edited",
  comments_edited: "Comments edited",
  approved: "Approved",
  unapproved: "Sent back to review",
  splits_changed: "Splits changed",
  folder_renamed: "Folder renamed",
  deleted: "Deleted",
};

const typeChipClass: Record<AuditEventType, string> = {
  ingest_started: "border-slate-300 bg-slate-50 text-slate-700",
  file_ingested: "border-blue-200 bg-blue-50 text-blue-800",
  file_transcribed: "border-violet-200 bg-violet-50 text-violet-800",
  file_graded: "border-amber-200 bg-amber-50 text-amber-800",
  text_edited: "border-amber-200 bg-amber-50 text-amber-800",
  comments_edited: "border-amber-200 bg-amber-50 text-amber-800",
  approved: "border-emerald-200 bg-emerald-50 text-emerald-800",
  unapproved: "border-orange-200 bg-orange-50 text-orange-800",
  splits_changed: "border-violet-200 bg-violet-50 text-violet-800",
  folder_renamed: "border-blue-200 bg-blue-50 text-blue-800",
  deleted: "border-rose-200 bg-rose-50 text-rose-800",
};

type ScopeFilter = "all" | "active" | "past";

const scopeFilters: Array<{ value: ScopeFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active queue" },
  { value: "past", label: "Past verifications" },
];

const allTypes: AuditEventType[] = [
  "ingest_started",
  "file_ingested",
  "file_transcribed",
  "file_graded",
  "text_edited",
  "comments_edited",
  "approved",
  "unapproved",
  "splits_changed",
  "folder_renamed",
  "deleted",
];

interface AuditTrailProps {
  events: AuditEvent[];
  activeDocumentIds: Set<string>;
}

export function AuditTrail({ events, activeDocumentIds }: AuditTrailProps) {
  const [scope, setScope] = useState<ScopeFilter>("all");
  const [enabledTypes, setEnabledTypes] = useState<Set<AuditEventType>>(
    new Set(allTypes),
  );
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (!enabledTypes.has(event.type)) return false;
      if (scope !== "all" && event.documentId) {
        const isActive = activeDocumentIds.has(event.documentId);
        if (scope === "active" && !isActive) return false;
        if (scope === "past" && isActive) return false;
      }
      if (needle.length === 0) return true;
      return (
        (event.documentId ?? "").toLowerCase().includes(needle) ||
        (event.folderId ?? "").toLowerCase().includes(needle) ||
        (event.title ?? "").toLowerCase().includes(needle) ||
        (event.detail ?? "").toLowerCase().includes(needle)
      );
    });
  }, [events, scope, enabledTypes, query, activeDocumentIds]);

  function toggleType(type: AuditEventType) {
    setEnabledTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter by scope"
          className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
        >
          {scopeFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setScope(filter.value)}
              aria-pressed={scope === filter.value}
              className={cn(
                "rounded-sm px-2.5 py-1 text-[12px] font-medium transition-colors",
                scope === filter.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter by document, folder, or detail"
          aria-label="Filter audit events"
          className="h-8 w-full max-w-xs rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      </div>

      <div
        role="group"
        aria-label="Filter by event type"
        className="flex flex-wrap gap-1.5"
      >
        {allTypes.map((type) => {
          const Icon = typeIcon[type];
          const active = enabledTypes.has(type);
          return (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              aria-pressed={active}
              className={cn(
                "inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] font-medium transition-colors",
                active
                  ? typeChipClass[type]
                  : "border-border bg-card text-muted-foreground hover:bg-muted",
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
              {typeLabel[type]}
            </button>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <div className="border border-dashed border-border bg-card px-6 py-12 text-center text-sm text-muted-foreground">
          No matching activity.
        </div>
      ) : (
        <ol className="border border-border bg-card">
          {filtered.map((event) => (
            <AuditRow key={event.id} event={event} />
          ))}
        </ol>
      )}
    </div>
  );
}

function AuditRow({ event }: { event: AuditEvent }) {
  const Icon = typeIcon[event.type];
  const [open, setOpen] = useState(false);
  const hasMetadata =
    event.metadata && Object.keys(event.metadata).length > 0;

  return (
    <li className="border-b border-border last:border-b-0">
      <div className="flex items-start gap-3 px-4 py-3">
        <span
          className={cn(
            "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border",
            typeChipClass[event.type],
          )}
        >
          <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-medium text-foreground">
              {typeLabel[event.type]}
            </span>
            {event.documentId ? (
              <Badge variant="outline" className="font-mono text-[11px]">
                {event.documentId}
              </Badge>
            ) : null}
            {event.folderId ? (
              <Badge variant="outline" className="font-mono text-[11px]">
                {event.folderId}
              </Badge>
            ) : null}
          </div>
          {event.detail ? (
            <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
              {event.detail}
            </p>
          ) : null}
          {event.title ? (
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">
              {event.title}
            </p>
          ) : null}
          {hasMetadata ? (
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-expanded={open}
              className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown
                className={cn(
                  "h-3 w-3 transition-transform",
                  open ? "rotate-180" : "",
                )}
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <FileText className="h-3 w-3" strokeWidth={1.8} aria-hidden="true" />
              {open ? "Hide metadata" : "Show metadata"}
            </button>
          ) : null}
          {hasMetadata && open ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded-sm border border-border bg-muted/40 px-3 py-2 font-mono text-[11px] text-foreground">
              {JSON.stringify(event.metadata, null, 2)}
            </pre>
          ) : null}
        </div>
        <time
          dateTime={event.timestamp}
          className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground"
          title={event.timestamp}
        >
          {formatTimestamp(event.timestamp)}
        </time>
      </div>
    </li>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
