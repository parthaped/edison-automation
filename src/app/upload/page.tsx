import { Download } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { UploadBatchForm } from "@/components/upload-batch-form";
import { Button } from "@/components/ui/button";
import { getRuntimeCapabilities } from "@/lib/edison/env";

export const metadata = {
  title: "Upload batch · Edison Automation Workbench",
};

const nav: Array<{ label: string; href: string; active?: boolean }> = [
  { label: "Review queue", href: "/" },
  { label: "Records", href: "/" },
  { label: "Upload", href: "/upload", active: true },
  { label: "Audit trail", href: "/" },
];

export default function UploadPage() {
  const capabilities = getRuntimeCapabilities();
  const aiReady = capabilities.ai === "configured";
  const blobReady = capabilities.files === "object-storage-configured";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteHeader />

      <main className="mx-auto w-full max-w-6xl px-6 pb-20 pt-8 sm:px-8 lg:px-10">
        <PageHeader />

        {!aiReady ? (
          <div className="mt-6 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong className="font-semibold">
              AI Gateway is not configured.
            </strong>{" "}
            Set <code className="font-mono">AI_GATEWAY_API_KEY</code> in
            <code className="font-mono"> .env.local</code> and restart the dev
            server to enable transcription and metadata extraction. Uploads will
            still be accepted, but transcriptions will be empty.
          </div>
        ) : null}

        {!blobReady ? (
          <div className="mt-3 border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <strong className="font-semibold">
              Vercel Blob is not configured.
            </strong>{" "}
            Set <code className="font-mono">BLOB_READ_WRITE_TOKEN</code> (create
            a Blob store in the Vercel dashboard under{" "}
            <strong>Storage</strong>) so files larger than 4 MB upload directly
            to Blob instead of through the serverless function. Without it,
            uploads of larger files will fail with{" "}
            <code className="font-mono">Request Entity Too Large</code> on
            Vercel.
          </div>
        ) : null}

        <section className="mt-6 grid gap-3 border border-border bg-card p-5 text-sm md:grid-cols-3">
          <PipelineStep
            n={1}
            title="Transcribe"
            body="Each file is sent to Gemini Flash-Lite via the Vercel AI Gateway. PDFs are read whole; images are sent as a vision message."
          />
          <PipelineStep
            n={2}
            title="Index"
            body="A second model call extracts document type, date, authors, recipients, names, and subjects as structured JSON."
          />
          <PipelineStep
            n={3}
            title="Download"
            body="The batch result is bundled into a ZIP folder with per-document transcription, metadata JSON, a manifest, and an Omeka CSV."
          />
        </section>

        <section className="mt-6" aria-label="Upload form">
          <UploadBatchForm />
        </section>
      </main>
    </div>
  );
}

function PipelineStep({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
          {n}
        </span>
        <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
        {body}
      </p>
    </div>
  );
}

function SiteHeader() {
  return (
    <header className="border-b border-border bg-background">
      <div className="bg-[#0f2548] text-white">
        <div className="mx-auto flex h-8 w-full max-w-6xl items-center justify-between px-6 text-[11px] sm:px-8 lg:px-10">
          <span className="truncate">
            Thomas A. Edison Papers · Rutgers University · School of Arts and
            Sciences
          </span>
          <span className="hidden text-white/70 sm:inline">
            Workbench · Internal
          </span>
        </div>
        <div className="h-px w-full bg-amber-500/80" aria-hidden="true" />
      </div>

      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-6 px-6 sm:px-8 lg:px-10">
        <Link href="/" className="flex min-w-0 items-center gap-3">
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
        </Link>
        <a
          href="/api/export/omeka"
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Download Omeka CSV
        </a>
      </div>

      <nav aria-label="Primary" className="border-t border-border bg-background">
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
        <nav
          aria-label="Breadcrumb"
          className="text-[12px] text-muted-foreground"
        >
          <ol className="flex items-center gap-1.5">
            <li>
              <Link href="/" className="hover:text-foreground hover:underline">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-foreground" aria-current="page">
              Upload
            </li>
          </ol>
        </nav>
        <h1 className="mt-2 text-2xl font-semibold text-foreground">
          Upload &amp; transcribe a batch
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Drop archival pages here. Each file is transcribed, indexed with
          structured metadata, and bundled into a downloadable folder.
        </p>
      </div>
      <Button variant="outline" size="sm" render={<Link href="/" />}>
        Back to review queue
      </Button>
    </div>
  );
}
