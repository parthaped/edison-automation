"use client";

import {
  FileInput,
  Gauge,
  ScanText,
  SignalHigh,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { AuditEvent, AuditEventKind } from "@/lib/edison/audit";
import type { ConfidenceBucket } from "@/lib/edison/types";
import { cn } from "@/lib/utils";

const kindIcon: Record<AuditEventKind, typeof FileInput> = {
  ingested: FileInput,
  transcribed: ScanText,
  graded: Gauge,
  status: SignalHigh,
};

const confidenceDot: Record<ConfidenceBucket, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-rose-500",
  blocked: "bg-slate-400",
};

type ConfidenceFilter = "all" | ConfidenceBucket;

const confidenceFilters: Array<{ value: ConfidenceFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
  { value: "blocked", label: "Blocked" },
];

export function AuditTrail({ events }: { events: AuditEvent[] }) {
  const [confidence, setConfidence] = useState<ConfidenceFilter>("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return events.filter((event) => {
      if (confidence !== "all" && event.confidence !== confidence) {
        return false;
      }
      if (needle.length === 0) return true;
      return (
        event.documentId.toLowerCase().includes(needle) ||
        event.folderId.toLowerCase().includes(needle) ||
        event.title.toLowerCase().includes(needle)
      );
    });
  }, [events, confidence, query]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          role="group"
          aria-label="Filter by confidence"
          className="inline-flex items-center gap-0.5 rounded-md border border-border bg-card p-0.5"
        >
          {confidenceFilters.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => setConfidence(filter.value)}
              aria-pressed={confidence === filter.value}
              className={cn(
                "rounded-sm px-2.5 py-1 text-[12px] font-medium transition-colors",
                confidence === filter.value
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
          placeholder="Filter by document or folder ID"
          aria-label="Filter by document or folder ID"
          className="h-8 w-full max-w-xs rounded-md border border-border bg-background px-3 text-[13px] text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
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
  const Icon = kindIcon[event.kind];
  return (
    <li className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium text-foreground">
            {event.label}
          </span>
          <Badge variant="outline" className="font-mono text-[11px]">
            {event.documentId}
          </Badge>
          <span className="inline-flex items-center gap-1 text-[11px] capitalize text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                confidenceDot[event.confidence],
              )}
            />
            {event.confidence}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
          {event.detail}
        </p>
      </div>
      <time
        dateTime={event.timestamp}
        className="shrink-0 whitespace-nowrap font-mono text-[11px] tabular-nums text-muted-foreground"
        title={event.timestamp}
      >
        {formatTimestamp(event.timestamp)}
      </time>
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
