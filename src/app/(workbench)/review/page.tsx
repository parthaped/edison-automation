import type { Metadata } from "next";
import Link from "next/link";
import { ReviewerWorkbench } from "@/components/reviewer-workbench";
import { ContentHeader } from "@/components/workbench/content-header";
import { Button } from "@/components/ui/button";
import { getEdisonService } from "@/lib/edison/service-factory";

export const metadata: Metadata = {
  title: "Review · Edison Automation Workbench",
};

interface ReviewPageProps {
  searchParams: Promise<{ doc?: string; offset?: string }>;
}

export default async function ReviewPage({ searchParams }: ReviewPageProps) {
  const { doc, offset: offsetParam } = await searchParams;
  const requestedOffset = Math.max(0, Number(offsetParam) || 0);
  const service = getEdisonService();
  const {
    summary,
    reviewCase,
    totalDocuments,
    hasMoreReviewDocuments,
    reviewOffset,
    reviewLimit,
  } = await service.getReviewWorkbench(doc, {
    offset: requestedOffset,
    limit: 50,
  });

  return (
    <>
      <ContentHeader
        title="Review"
        description="Verify AI transcriptions against the source images before export. Low-confidence records need careful review."
        action={<ConfidenceCounts summary={summary} />}
      />
      <main className="flex flex-1 flex-col overflow-y-auto">
        {reviewCase ? (
          <div className="p-4 sm:p-6">
            {totalDocuments > reviewLimit ? (
              <ReviewPagination
                doc={doc}
                offset={reviewOffset}
                limit={reviewLimit}
                total={totalDocuments}
                hasMore={hasMoreReviewDocuments}
              />
            ) : null}
            <ReviewerWorkbench
              key={
                doc &&
                reviewCase.documents.some((d) => d.documentId === doc)
                  ? doc
                  : reviewCase.selectedDocumentId
              }
              documents={reviewCase.documents}
              transcriptions={reviewCase.transcriptions}
              metadata={reviewCase.metadata}
              initialDocumentId={
                doc && reviewCase.documents.some((d) => d.documentId === doc)
                  ? doc
                  : reviewCase.selectedDocumentId
              }
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <div className="max-w-md border border-dashed border-border bg-card px-6 py-14 text-center">
              <h2 className="text-base font-semibold text-foreground">
                No documents to review yet
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload a batch to transcribe pages. Once processing completes,
                records appear here for verification.
              </p>
              <Button
                className="mt-5"
                render={<Link href="/upload" />}
              >
                Upload &amp; transcribe
              </Button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}

function ReviewPagination({
  doc,
  offset,
  limit,
  total,
  hasMore,
}: {
  doc?: string;
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
}) {
  const prevOffset = Math.max(0, offset - limit);
  const nextOffset = offset + limit;
  const page = Math.floor(offset / limit) + 1;
  const pageCount = Math.ceil(total / limit);
  const docQuery = doc ? `&doc=${encodeURIComponent(doc)}` : "";

  return (
    <nav
      aria-label="Review queue pagination"
      className="mb-4 flex items-center justify-between gap-3 text-sm text-muted-foreground"
    >
      <span>
        Showing {offset + 1}&ndash;{Math.min(offset + limit, total)} of {total}{" "}
        records
      </span>
      <div className="flex items-center gap-2">
        {offset > 0 ? (
          <Button
            variant="outline"
            size="sm"
            render={
              <Link href={`/review?offset=${prevOffset}${docQuery}`} />
            }
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
            render={
              <Link href={`/review?offset=${nextOffset}${docQuery}`} />
            }
          >
            Next
          </Button>
        ) : null}
      </div>
    </nav>
  );
}

function ConfidenceCounts({
  summary,
}: {
  summary: {
    highConfidence: number;
    lowConfidence: number;
    mediumConfidence: number;
    blocked: number;
    readyToExport: number;
  };
}) {
  const cells: Array<{ label: string; count: number; dot: string }> = [
    { label: "High", count: summary.highConfidence, dot: "bg-emerald-500" },
    { label: "Medium", count: summary.mediumConfidence, dot: "bg-amber-500" },
    { label: "Low", count: summary.lowConfidence, dot: "bg-rose-500" },
    { label: "Blocked", count: summary.blocked, dot: "bg-slate-400" },
    {
      label: "Ready",
      count: summary.readyToExport,
      dot: "bg-sky-500",
    },
  ];
  return (
    <dl className="flex items-center gap-4">
      {cells.map((cell) => (
        <div key={cell.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className={`inline-block h-1.5 w-1.5 rounded-full ${cell.dot}`}
          />
          <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {cell.label}
          </dt>
          <dd className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
            {cell.count}
          </dd>
        </div>
      ))}
    </dl>
  );
}
