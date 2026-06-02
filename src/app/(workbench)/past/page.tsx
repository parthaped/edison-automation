import type { Metadata } from "next";
import Link from "next/link";
import {
  PastVerificationsTable,
  type PastVerificationRow,
} from "@/components/past-verifications-table";
import { ContentHeader } from "@/components/workbench/content-header";
import { Button } from "@/components/ui/button";
import { getEdisonService } from "@/lib/edison/service-factory";
import type { ConfidenceBucket } from "@/lib/edison/types";

export const metadata: Metadata = {
  title: "Past verifications · Edison Automation Workbench",
};

interface PastPageProps {
  searchParams: Promise<{ offset?: string }>;
}

const PAGE_SIZE = 50;

export default async function PastPage({ searchParams }: PastPageProps) {
  const { offset: offsetParam } = await searchParams;
  const offset = Math.max(0, Number(offsetParam) || 0);
  const service = getEdisonService();
  const [page, auditEvents] = await Promise.all([
    service.getApprovedDocuments({ offset, limit: PAGE_SIZE }),
    // Pull a generous window of approvals so we can label each row with the
    // most recent approval timestamp. The audit log is the source of truth
    // for *when* a document was approved (the document's `updatedAt` can
    // shift when comments are edited post-approval).
    service.getAuditTrail({ limit: 500, types: ["approved"] }),
  ]);

  const approvalByDocId = new Map<string, string>();
  for (const event of auditEvents) {
    if (event.documentId && !approvalByDocId.has(event.documentId)) {
      approvalByDocId.set(event.documentId, event.timestamp);
    }
  }

  const rows: PastVerificationRow[] = page.documents.map((document) => {
    const meta = page.metadata[document.documentId];
    return {
      documentId: document.documentId,
      folderId: document.folderId,
      title: meta?.title || document.title,
      date: meta?.date ?? "",
      confidence: document.confidence as ConfidenceBucket,
      approvedAt:
        approvalByDocId.get(document.documentId) ?? document.updatedAt,
    };
  });

  return (
    <>
      <ContentHeader
        title="Past verifications"
        description="Documents you've approved. Download per-row Omeka CSVs or send a record back to review."
        action={
          <Button
            variant="outline"
            size="sm"
            render={
              <a
                href="/api/export/transcriptions"
                download="omeka-transcriptions.csv"
              />
            }
          >
            Download all approved (CSV)
          </Button>
        }
      />
      <main className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
        {rows.length === 0 && offset === 0 ? (
          <div className="mx-auto w-full max-w-4xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <h2 className="text-base font-semibold text-foreground">
              No approved transcriptions yet
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Approve documents in the{" "}
              <Link href="/review" className="underline">
                Review
              </Link>{" "}
              tab to see them here.
            </p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-6xl">
            <PastVerificationsTable
              rows={rows}
              totalCount={page.totalCount}
              offset={page.offset}
              limit={page.limit}
              hasMore={page.hasMore}
            />
          </div>
        )}
      </main>
    </>
  );
}
