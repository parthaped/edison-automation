import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, FileSearch, Layers, Sparkles } from "lucide-react";
import { LandingExploreGrid } from "@/components/research/landing-explore-grid";
import { SearchBar } from "@/components/research/search-bar";

export const metadata: Metadata = {
  title: "Edison Papers Research Platform",
  description:
    "Semantic search across Thomas A. Edison Papers — letters, lab notes, patents, and business records from edisondigital.rutgers.edu.",
};

const exampleQueries = [
  "crushing ore",
  "electric light filament",
  "Menlo Park laboratory",
  "phonograph recording",
  "nickel iron battery",
];

const features = [
  {
    icon: Sparkles,
    title: "Context-aware search",
    description:
      "Find documents by meaning, not just exact words. Searching for \"crushing ore\" also surfaces records about breaking apart ore, smashing ore, and mineral processing.",
  },
  {
    icon: Layers,
    title: "Live Omeka S catalog",
    description:
      "Results come directly from edisondigital.rutgers.edu — titles, Dublin Core fields, transcriptions, collections, and document types.",
  },
  {
    icon: FileSearch,
    title: "Archival context",
    description:
      "Every result links back to the authoritative Edison Digital edition with full images, transcriptions, and TAEP catalog references.",
  },
];

export default function ResearchHomePage() {
  return (
    <div>
      <section className="border-b border-border bg-gradient-to-b from-white to-[#f4f6f9]">
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/70">
            Thomas A. Edison Papers
          </p>
          <h1 className="mt-4 text-[2rem] font-bold tracking-tight text-foreground sm:text-5xl lg:text-[3.25rem] lg:leading-[1.1]">
            Discover Edison&apos;s papers<br className="hidden sm:block" /> by meaning
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            Search letters, lab notebooks, patents, and correspondence from the
            Edison Digital edition — by meaning, not just exact words.
          </p>

          <div className="mx-auto mt-10 max-w-2xl">
            <SearchBar size="hero" autoFocus />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <span className="text-xs text-muted-foreground/70">Try:</span>
            {exampleQueries.map((query) => (
              <Link
                key={query}
                href={`/search?q=${encodeURIComponent(query)}`}
                className="rounded-full border border-border/80 bg-white px-3 py-1 text-xs text-foreground/70 transition-colors hover:border-primary/30 hover:bg-primary/5 hover:text-foreground"
              >
                {query}
              </Link>
            ))}
          </div>

          <p className="mt-6">
            <Link
              href="/search/advanced"
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              Advanced search — filter by time period, type, author, place, and more
            </Link>
          </p>
        </div>
      </section>

      <LandingExploreGrid />

      <section className="mx-auto max-w-6xl px-4 pb-12 sm:px-6 sm:pb-16">
        <div className="mb-8 max-w-2xl">
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
            How search works
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
            Semantic search across the live Edison Digital catalog — find documents
            by meaning, not just exact words.
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <div
                key={feature.title}
                className="rounded-xl border border-border bg-white p-6 transition-shadow hover:shadow-sm"
              >
                <div className="flex size-9 items-center justify-center rounded-lg bg-primary/8 text-primary">
                  <Icon className="size-4.5" strokeWidth={1.7} aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-sm font-semibold tracking-tight">{feature.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {feature.description}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-4 py-8 sm:flex-row sm:items-center sm:px-6">
          <p className="max-w-xl text-sm text-muted-foreground">
            Searches the live Omeka S catalog at{" "}
            <span className="text-foreground/70">edisondigital.rutgers.edu</span>.
            Staff tools are available in the secured Workbench.
          </p>
          <Link
            href="/search?q=Edison"
            className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-primary transition-colors hover:text-primary/80"
          >
            Browse all documents
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>
    </div>
  );
}
