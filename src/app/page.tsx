import {
  AlertTriangle,
  Archive,
  ArrowRight,
  CheckCircle2,
  Clock,
  Download,
  FileWarning,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import { ReviewerWorkbench } from "@/components/reviewer-workbench";
import { FadeRise, Stagger } from "@/components/motion-primitives";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { getEdisonService } from "@/lib/edison/service-factory";

const requirements = [
  "PDF, JPEG, PNG, TIFF, WebP, GIF, DOCX, CSV",
  "Multi-page PDFs and TIFFs become ordered page manifests",
  "Misleading extensions and MIME mismatches create warnings",
  "Corrupt, password-protected, unsupported, or huge files are routed to manual review",
];

export default async function Home() {
  const { summary, reviewCase } = await getEdisonService().getDashboard();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar />

      <main className="mx-auto w-full max-w-6xl px-6 pb-24 pt-14 sm:px-8 lg:px-10">
        <Hero />

        <section aria-labelledby="queue-title" className="mt-20">
          <FadeRise delay={0.05}>
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700/90">
                  Processing queues
                </p>
                <h2
                  id="queue-title"
                  className="mt-2 text-3xl font-semibold tracking-[-0.02em] text-foreground"
                >
                  What needs attention
                </h2>
              </div>
              <p className="max-w-xs text-sm text-muted-foreground">
                Live counts across ingest, transcription, review, and Omeka export queues.
              </p>
            </div>
          </FadeRise>

          <Stagger className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <QueueCard
              icon={FileWarning}
              label="Low confidence"
              count={summary.lowConfidence}
              detail="Requires careful human review before export."
              accent="rose"
            />
            <QueueCard
              icon={Clock}
              label="Medium confidence"
              count={summary.mediumConfidence}
              detail="Ready for normal review and corrections."
              accent="amber"
            />
            <QueueCard
              icon={AlertTriangle}
              label="Blocked ingest"
              count={summary.blocked}
              detail="Unsupported, corrupt, encrypted, or oversized files."
              accent="neutral"
            />
            <QueueCard
              icon={CheckCircle2}
              label="Ready to export"
              count={summary.readyToExport}
              detail="Approved records waiting for Omeka upload."
              accent="emerald"
            />
          </Stagger>
        </section>

        <section className="mt-16 grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
          <FadeRise delay={0.1}>
            <Card className="h-full surface-elevated">
              <CardHeader>
                <CardTitle className="text-xl font-semibold tracking-[-0.01em]">
                  Incoming file requirements
                </CardTitle>
                <CardDescription>
                  What the pipeline expects when materials arrive from Box.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2.5 md:grid-cols-2">
                  {requirements.map((item) => (
                    <li
                      key={item}
                      className="group flex items-start gap-3 rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-foreground/85 transition-colors hover:border-border hover:bg-muted/70"
                    >
                      <span
                        aria-hidden="true"
                        className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500/70"
                      />
                      <span className="leading-snug">{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </FadeRise>

          <FadeRise delay={0.15}>
            <Card className="h-full surface-elevated">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <div className="rounded-xl border border-amber-200/70 bg-amber-50/80 p-2 text-amber-700">
                    <Archive className="h-5 w-5" strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <div>
                    <CardTitle className="text-xl font-semibold tracking-[-0.01em]">
                      Omeka alignment
                    </CardTitle>
                    <CardDescription>
                      Folder ID, Doc ID, media names, and export fields stay visible.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <dl className="space-y-4 text-sm">
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Folder model
                    </dt>
                    <dd className="mt-1 font-medium text-foreground">
                      Omeka item set identifier, such as{" "}
                      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
                        D9032-F
                      </code>
                    </dd>
                  </div>
                  <Separator className="bg-border/70" />
                  <div>
                    <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Document model
                    </dt>
                    <dd className="mt-1 font-medium text-foreground">
                      Omeka item identifier, such as{" "}
                      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.8em] text-foreground">
                        D9032-00001
                      </code>
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </FadeRise>
        </section>

        <section className="mt-16">
          {reviewCase ? (
            <FadeRise delay={0.2}>
              <ReviewerWorkbench
                documents={reviewCase.documents}
                transcription={reviewCase.transcription}
                metadata={reviewCase.metadata}
                reviewEvents={reviewCase.reviewEvents}
              />
            </FadeRise>
          ) : (
            <Card className="surface-elevated border-dashed">
              <CardContent className="py-16 text-center">
                <h2 className="text-2xl font-semibold tracking-[-0.01em]">
                  No documents have been ingested yet.
                </h2>
                <p className="mt-3 text-muted-foreground">
                  Upload a batch or connect a Box folder to start the review workflow.
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      </main>
    </div>
  );
}

function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/65">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-6 sm:px-8 lg:px-10">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-200/70 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <Image
              src="/favicon.svg"
              alt=""
              width={18}
              height={24}
              priority
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700/90">
              Edison Papers
            </span>
            <span className="mt-0.5 text-sm font-semibold tracking-[-0.01em] text-foreground">
              Automation Workbench
            </span>
          </div>
        </div>
        <a
          href="/api/export/omeka"
          className={buttonVariants({
            size: "sm",
            className: "gap-2 rounded-full px-4 shadow-[0_1px_2px_rgba(0,0,0,0.06)]",
          })}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Download Omeka CSV
        </a>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section
      aria-label="Edison Automation overview"
      className="relative isolate overflow-hidden rounded-3xl"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(245,158,11,0.10),transparent_70%)]"
      />
      <FadeRise>
        <div className="flex flex-col gap-7 px-2 py-8 sm:py-12">
          <div className="inline-flex w-fit items-center gap-2 rounded-full border border-amber-200/70 bg-amber-50/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            Thomas A. Edison Papers
          </div>
          <h1 className="max-w-4xl text-4xl font-semibold leading-[1.05] tracking-[-0.03em] text-foreground sm:text-5xl md:text-6xl">
            Automation workbench for transcription review and Omeka-ready indexing.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
            Ingest Box files, extract pages, assign document IDs, grade transcription
            confidence, and help reviewers correct archival text before public publication.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="#queue-title"
              className={buttonVariants({
                size: "lg",
                className: "gap-2 rounded-full px-5",
              })}
            >
              Review queue
              <ArrowRight className="h-4 w-4" strokeWidth={1.8} aria-hidden="true" />
            </a>
            <Badge
              variant="secondary"
              className="rounded-full border-border/70 bg-muted/70 px-3 py-1 text-xs font-medium text-muted-foreground"
            >
              Vercel + managed workers
            </Badge>
          </div>
        </div>
      </FadeRise>
    </section>
  );
}

const accentMap = {
  amber: {
    chip: "border-amber-200/70 bg-amber-50/80 text-amber-700",
    rule: "bg-amber-500/80",
  },
  rose: {
    chip: "border-rose-200/70 bg-rose-50/80 text-rose-700",
    rule: "bg-rose-500/80",
  },
  emerald: {
    chip: "border-emerald-200/70 bg-emerald-50/80 text-emerald-700",
    rule: "bg-emerald-500/80",
  },
  neutral: {
    chip: "border-border bg-muted/70 text-foreground/70",
    rule: "bg-foreground/30",
  },
} as const;

type QueueAccent = keyof typeof accentMap;

function QueueCard({
  icon: Icon,
  label,
  count,
  detail,
  accent,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  detail: string;
  accent: QueueAccent;
}) {
  const tone = accentMap[accent];
  return (
    <article className="group relative h-full overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-border hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_16px_40px_-16px_rgba(0,0,0,0.12)]">
      <div className={`absolute inset-x-5 top-0 h-px ${tone.rule} opacity-60`} aria-hidden="true" />
      <div className="flex items-start justify-between">
        <div className={`rounded-xl border p-2 ${tone.chip}`}>
          <Icon className="h-4.5 w-4.5" strokeWidth={1.5} aria-hidden="true" />
        </div>
        <span className="font-sans text-4xl font-semibold tabular-nums tracking-[-0.02em] text-foreground">
          {count}
        </span>
      </div>
      <h3 className="mt-5 text-base font-semibold tracking-[-0.01em] text-foreground">
        {label}
      </h3>
      <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{detail}</p>
    </article>
  );
}
