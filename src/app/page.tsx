import { AlertTriangle, Archive, CheckCircle2, Clock, FileWarning } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { BoxUploadQueue } from "@/components/box-upload-queue";
import { ReviewerWorkbench } from "@/components/reviewer-workbench";
import { getEdisonService } from "@/lib/edison/service-factory";

export default async function Home() {
  const { summary, boxUploads, reviewCase } = await getEdisonService().getDashboard();

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <header className="rounded-3xl bg-slate-950 p-6 text-white shadow-sm lg:p-8">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white p-2 shadow-sm">
              <Image
                src="/edison-logo.svg"
                alt="Edison Automation light bulb logo"
                width={42}
                height={56}
                priority
              />
            </div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-amber-300">
              Thomas A. Edison Papers
            </p>
          </div>
          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px] lg:items-end">
            <div>
              <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl">
                Automation workbench for transcription review and Omeka-ready indexing.
              </h1>
              <p className="mt-4 max-w-3xl text-lg leading-8 text-slate-300">
                Ingest Box files, extract pages, assign document IDs, grade transcription confidence,
                and help reviewers correct archival text before public publication.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/10 p-4">
              <p className="text-sm font-semibold text-slate-300">Deployment target</p>
              <p className="mt-1 text-2xl font-semibold">Vercel + managed workers</p>
              <p className="mt-2 text-sm text-slate-300">
                Browser-accessible across machines with durable jobs, object storage, and export APIs.
              </p>
            </div>
          </div>
        </header>

        <section aria-labelledby="queue-title" className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Processing queues
              </p>
              <h2 id="queue-title" className="text-3xl font-semibold tracking-tight">
                What needs attention
              </h2>
            </div>
            <a
              href="/api/export/omeka"
              className="rounded-full bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-amber-300"
            >
              Download Omeka CSV
            </a>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <QueueCard
              icon={<FileWarning aria-hidden="true" />}
              label="New Box uploads"
              count={summary.pendingBoxUploads}
              detail="Completed Box uploads waiting for Start transcription."
            />
            <QueueCard
              icon={<Clock aria-hidden="true" />}
              label="Medium confidence"
              count={summary.mediumConfidence}
              detail="Ready for normal review and corrections."
            />
            <QueueCard
              icon={<AlertTriangle aria-hidden="true" />}
              label="Blocked ingest"
              count={summary.blocked}
              detail="Unsupported, corrupt, encrypted, or oversized files."
            />
            <QueueCard
              icon={<CheckCircle2 aria-hidden="true" />}
              label="Ready to export"
              count={summary.readyToExport}
              detail="Approved records waiting for Omeka upload."
            />
          </div>
        </section>

        <BoxUploadQueue uploads={boxUploads} />

        <section className="grid gap-4 lg:grid-cols-[1fr_360px]">
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-2xl font-semibold">Incoming file requirements</h2>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {[
                "PDF, JPEG, PNG, TIFF, WebP, GIF, DOCX, CSV",
                "Multi-page PDFs and TIFFs become ordered page manifests",
                "Misleading extensions and MIME mismatches create warnings",
                "Corrupt, password-protected, unsupported, or huge files are routed to manual review",
              ].map((item) => (
                <div key={item} className="rounded-2xl bg-slate-100 p-4 text-sm font-medium text-slate-800">
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <Archive className="h-8 w-8 text-amber-600" aria-hidden="true" />
              <div>
                <h2 className="text-2xl font-semibold">Omeka alignment</h2>
                <p className="text-sm text-slate-600">Folder ID, Doc ID, media names, and export fields stay visible.</p>
              </div>
            </div>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="font-semibold text-slate-500">Folder model</dt>
                <dd className="text-slate-950">Omeka item set identifier, such as D9032-F</dd>
              </div>
              <div>
                <dt className="font-semibold text-slate-500">Document model</dt>
                <dd className="text-slate-950">Omeka item identifier, such as D9032-00001</dd>
              </div>
            </dl>
          </div>
        </section>

        {reviewCase ? (
          <ReviewerWorkbench
            documents={reviewCase.documents}
            transcription={reviewCase.transcription}
            metadata={reviewCase.metadata}
            reviewEvents={reviewCase.reviewEvents}
          />
        ) : (
          <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center">
            <h2 className="text-2xl font-semibold">No documents have been ingested yet.</h2>
            <p className="mt-3 text-slate-600">
              Upload a batch or connect a Box folder to start the review workflow.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}

function QueueCard({
  icon,
  label,
  count,
  detail,
}: {
  icon: ReactNode;
  label: string;
  count: number;
  detail: string;
}) {
  return (
    <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">{icon}</div>
        <span className="text-4xl font-semibold text-slate-950">{count}</span>
      </div>
      <h3 className="mt-4 text-xl font-semibold text-slate-950">{label}</h3>
      <p className="mt-2 text-sm leading-6 text-slate-600">{detail}</p>
    </article>
  );
}
