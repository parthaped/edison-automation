"use client";

import { Download, ExternalLink, Loader2, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ConfidenceBucket } from "@/lib/edison/types";

export interface PastVerificationRow {
  documentId: string;
  folderId: string;
  title: string;
  date: string;
  confidence: ConfidenceBucket;
  approvedAt: string;
}

interface PastVerificationsTableProps {
  rows: PastVerificationRow[];
  totalCount: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

const confidenceDot: Record<ConfidenceBucket, string> = {
  high: "bg-emerald-500",
  medium: "bg-amber-500",
  low: "bg-rose-500",
  blocked: "bg-slate-400",
};

export function PastVerificationsTable({
  rows,
  totalCount,
  offset,
  limit,
  hasMore,
}: PastVerificationsTableProps) {
  const router = useRouter();
  const [optimisticallyRemoved, setOptimisticallyRemoved] = useState<Set<string>>(
    new Set(),
  );
  const [pendingId, setPendingId] = useState<string | null>(null);

  const visibleRows = rows.filter(
    (row) => !optimisticallyRemoved.has(row.documentId),
  );

  async function handleSendBack(row: PastVerificationRow) {
    if (pendingId) return;
    setPendingId(row.documentId);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(row.documentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "needs_review" }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null;
        throw new Error(
          data?.error?.message ?? `Unapprove failed (${response.status}).`,
        );
      }
      setOptimisticallyRemoved((current) => {
        const next = new Set(current);
        next.add(row.documentId);
        return next;
      });
      toast.success(`${row.documentId} sent back to review.`);
      router.refresh();
    } catch (error) {
      toast.error("Could not send document back to review", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setPendingId(null);
    }
  }

  if (visibleRows.length === 0) {
    return (
      <div className="border border-dashed border-border bg-card px-6 py-14 text-center">
        <h2 className="text-base font-semibold text-foreground">
          No approved transcriptions yet
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Documents you approve in{" "}
          <Link href="/workbench/review" className="underline">
            Review
          </Link>{" "}
          will appear here ready for download.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="overflow-hidden border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">
                GLOC
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Doc ID
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Title
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Date
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Confidence
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                Approved at
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const pending = pendingId === row.documentId;
              return (
                <tr
                  key={row.documentId}
                  className="border-t border-border align-top"
                >
                  <td className="px-3 py-2 font-mono text-[12px] text-foreground">
                    {row.folderId}
                  </td>
                  <td className="px-3 py-2 font-mono text-[12px] text-foreground">
                    {row.documentId}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    <span className="block truncate" title={row.title}>
                      {row.title}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.date || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 text-[12px] capitalize text-foreground">
                      <span
                        aria-hidden="true"
                        className={`inline-block h-1.5 w-1.5 rounded-full ${confidenceDot[row.confidence]}`}
                      />
                      {row.confidence}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {formatTimestamp(row.approvedAt)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        render={
                          <Link
                            href={`/viewer/${encodeURIComponent(row.documentId)}`}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <ExternalLink
                          className="h-3.5 w-3.5"
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />
                        Open
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        render={
                          <a
                            href={`/api/export/transcriptions/${encodeURIComponent(row.documentId)}`}
                            download={`${row.documentId}-omeka.csv`}
                          />
                        }
                      >
                        <Download
                          className="h-3.5 w-3.5"
                          strokeWidth={1.8}
                          aria-hidden="true"
                        />
                        CSV
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleSendBack(row)}
                        disabled={pending}
                      >
                        {pending ? (
                          <Loader2
                            className="h-3.5 w-3.5 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <RotateCcw
                            className="h-3.5 w-3.5"
                            strokeWidth={1.8}
                            aria-hidden="true"
                          />
                        )}
                        Send back
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Pagination
        offset={offset}
        limit={limit}
        total={totalCount}
        hasMore={hasMore}
      />
    </div>
  );
}

function Pagination({
  offset,
  limit,
  total,
  hasMore,
}: {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}) {
  if (total <= limit) return null;
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.ceil(total / limit);
  return (
    <nav
      aria-label="Past verifications pagination"
      className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
    >
      <span>
        Showing {offset + 1}&ndash;{Math.min(offset + limit, total)} of {total}{" "}
        approved
      </span>
      <div className="flex items-center gap-2">
        {offset > 0 ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/workbench/past?offset=${prevOffset}`} />}
          >
            Previous
          </Button>
        ) : null}
        <span className="font-mono text-xs tabular-nums">
          Page {page} / {pageCount}
        </span>
        {hasMore ? (
          <Button
            variant="outline"
            size="sm"
            render={<Link href={`/workbench/past?offset=${nextOffset}`} />}
          >
            Next
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
