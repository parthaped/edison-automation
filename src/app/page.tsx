import { Download } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { ReviewerWorkbench } from "@/components/reviewer-workbench";
import { Button } from "@/components/ui/button";
import { getEdisonService } from "@/lib/edison/service-factory";

const requirements = [
  "PDF, JPEG, PNG, TIFF, WebP, GIF, DOCX, CSV",
  "Multi-page PDFs and TIFFs become ordered page manifests",
  "Misleading extensions and MIME mismatches create warnings",
  "Corrupt, password-protected, unsupported, or huge files are routed to manual review",
];

const omekaFields: Array<{ label: string; value: string; example: string }> = [
  {
    label: "Folder model",
    value: "Omeka item set identifier",
    example: "D9032-F",
  },
  {
    label: "Document model",
    value: "Omeka item identifier",
    example: "D9032-00001",
  },
];

const nav: Array<{ label: string; href: string; active?: boolean }> = [
  { label: "Review queue", href: "/", active: true },
  { label: "Records", href: "/" },
  { label: "Upload", href: "/upload" },
  { label: "Audit trail", href: "/" },
];

export default async function Home() {
  const { summary, reviewCase } = await getEdisonService().getDashboard();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 sm:px-8 lg:px-10">
        <PageHeader />

        <section aria-labelledby="queue-title" className="mt-8">
          <SectionHeader
            id="queue-title"
            title="Processing queues"
            caption="Live counts across ingest, transcription, review, and Omeka export queues."
          />
          <StatStrip
            cells={[
              {
                label: "Low confidence",
                count: summary.lowConfidence,
                caption: "Requires careful human review before export.",
                marker: "rose",
              },
              {
                label: "Medium confidence",
                count: summary.mediumConfidence,
                caption: "Ready for normal review and corrections.",
                marker: "amber",
              },
              {
                label: "Blocked ingest",
                count: summary.blocked,
                caption: "Unsupported, corrupt, encrypted, or oversized files.",
                marker: "neutral",
              },
              {
                label: "Ready to export",
                count: summary.readyToExport,
                caption: "Approved records waiting for Omeka upload.",
                marker: "neutral",
              },
            ]}
          />
        </section>

        <section aria-labelledby="reference-title" className="mt-10">
          <SectionHeader
            id="reference-title"
            title="Pipeline reference"
            caption="Inputs the pipeline accepts and the Omeka identifiers it emits."
          />
          <div className="grid divide-y divide-border border border-border bg-card md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Incoming file requirements
              </h3>
              <ul className="mt-3 divide-y divide-border text-sm text-foreground">
                {requirements.map((item) => (
                  <li key={item} className="py-2 leading-snug">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-5">
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Omeka alignment
              </h3>
              <table className="mt-3 w-full border-collapse text-sm">
                <tbody>
                  {omekaFields.map((row) => (
                    <tr key={row.label} className="border-t border-border first:border-t-0">
                      <th
                        scope="row"
                        className="w-[40%] py-2 pr-3 text-left align-top font-medium text-foreground"
                      >
                        {row.label}
                      </th>
                      <td className="py-2 align-top text-muted-foreground">
                        <div>{row.value}</div>
                        <code className="mt-1 inline-block rounded-sm bg-muted px-1.5 py-0.5 font-mono text-[12px] text-foreground">
                          {row.example}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section aria-labelledby="review-title" className="mt-10">
          <SectionHeader
            id="review-title"
            title="Reviewer workbench"
            caption="Open record, source images, transcription, and audit trail for the next item in queue."
          />
          {reviewCase ? (
            <ReviewerWorkbench
              documents={reviewCase.documents}
              transcription={reviewCase.transcription}
              metadata={reviewCase.metadata}
              reviewEvents={reviewCase.reviewEvents}
            />
          ) : (
            <div className="border border-dashed border-border bg-card px-6 py-14 text-center">
              <h3 className="text-lg font-semibold text-foreground">
                No documents have been ingested yet.
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Upload a batch or connect a Box folder to start the review workflow.
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="bg-[#0f2548] text-white">
        <div className="mx-auto flex h-8 w-full max-w-6xl items-center justify-between px-6 text-[11px] sm:px-8 lg:px-10">
          <span className="truncate">
            Thomas A. Edison Papers · Rutgers University · School of Arts and Sciences
          </span>
          <span className="hidden text-white/70 sm:inline">
            Workbench · Internal
          </span>
        </div>
        <div className="h-px w-full bg-amber-500/80" aria-hidden="true" />
      </div>

      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-6 sm:px-8 lg:px-10">
        <div className="flex min-w-0 items-center gap-3">
          <Image
            src="/favicon.svg"
            alt=""
            width={18}
            height={24}
            priority
            aria-hidden="true"
            className="shrink-0"
          />
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Edison Papers
            </span>
            <span className="truncate text-[15px] font-semibold text-foreground">
              Automation Workbench
            </span>
          </div>
        </div>
        <a
          href="/api/export/omeka"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Download Omeka CSV
        </a>
      </div>

      <nav
        aria-label="Primary"
        className="border-t border-border bg-background"
      >
        <ul className="mx-auto flex w-full max-w-6xl items-stretch gap-1 px-6 text-[13px] sm:px-8 lg:px-10">
          {nav.map((item) => (
            <li key={item.label}>
              <Link
                href={item.href}
                aria-current={item.active ? "page" : undefined}
                className={
                  item.active
                    ? "inline-flex h-10 items-center border-b-2 border-primary px-3 font-semibold text-foreground"
                    : "inline-flex h-10 items-center border-b-2 border-transparent px-3 font-medium text-muted-foreground transition-colors hover:text-foreground"
                }
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}

function PageHeader() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
      <div className="min-w-0">
        <nav aria-label="Breadcrumb" className="text-[12px] text-muted-foreground">
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-foreground hover:underline">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-foreground" aria-current="page">
              Review queue
            </li>
          </ol>
        </nav>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          Review queue
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Ingest Box files, extract pages, assign document IDs, grade transcription
          confidence, and correct archival text before public publication.
        </p>
      </div>
      <Button variant="outline" size="sm" render={<a href="#review-title" />}>
        Jump to workbench
      </Button>
    </div>
  );
}

function SectionHeader({
  id,
  title,
  caption,
}: {
  id?: string;
  title: string;
  caption?: string;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
      <h2 id={id} className="text-[15px] font-semibold text-foreground">
        {title}
      </h2>
      {caption ? (
        <p className="max-w-md text-[12px] text-muted-foreground">{caption}</p>
      ) : null}
    </div>
  );
}

type MarkerTone = "rose" | "amber" | "neutral";

interface StatCell {
  label: string;
  count: number;
  caption: string;
  marker: MarkerTone;
}

const markerClass: Record<MarkerTone, string> = {
  rose: "before:bg-rose-500",
  amber: "before:bg-amber-500",
  neutral: "before:bg-transparent",
};

function StatStrip({ cells }: { cells: StatCell[] }) {
  return (
    <div className="grid divide-y divide-border border border-border bg-card sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
      {cells.map((cell, idx) => (
        <div
          key={cell.label}
          className={
            "relative px-5 py-4 before:absolute before:bottom-2 before:left-0 before:top-2 before:w-[2px] " +
            markerClass[cell.marker] +
            (idx > 0 ? " sm:border-t sm:border-border lg:border-t-0" : "")
          }
        >
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {cell.label}
          </div>
          <div className="mt-1 font-mono text-[28px] font-semibold tabular-nums text-foreground">
            {cell.count}
          </div>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            {cell.caption}
          </p>
        </div>
      ))}
    </div>
  );
}
