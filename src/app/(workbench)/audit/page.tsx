import type { Metadata } from "next";
import { AuditTrail } from "@/components/workbench/audit-trail";
import { ContentHeader } from "@/components/workbench/content-header";
import { getEdisonService } from "@/lib/edison/service-factory";

export const metadata: Metadata = {
  title: "Audit trail · Edison Automation Workbench",
};

export default async function AuditPage() {
  const service = getEdisonService();
  const [events, records] = await Promise.all([
    service.getAuditTrail({ limit: 500 }),
    service.getRepository().listDocumentRecords(),
  ]);

  // The Active/Past scope filter lives client-side, but it needs to know
  // which document ids are still in the active queue vs already approved
  // or exported. We pass the set down so the client doesn't have to fetch.
  const activeDocumentIds = new Set(
    records.documents
      .filter(
        (document) =>
          document.status !== "approved" && document.status !== "exported",
      )
      .map((document) => document.documentId),
  );

  return (
    <>
      <ContentHeader
        title="Audit trail"
        description="Append-only log of ingest, transcription, review edits, approvals, splits, and folder renames."
      />
      <main className="flex-1 overflow-y-auto px-6 py-6 sm:px-8">
        {events.length === 0 ? (
          <div className="mx-auto w-full max-w-4xl border border-dashed border-border bg-card px-6 py-14 text-center">
            <h2 className="text-base font-semibold text-foreground">
              No activity yet
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Once you upload and transcribe a batch, every processing step is
              recorded here.
            </p>
          </div>
        ) : (
          <AuditTrail events={events} activeDocumentIds={activeDocumentIds} />
        )}
      </main>
    </>
  );
}
