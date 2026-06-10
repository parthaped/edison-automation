import Link from "next/link";
import { Calendar, ExternalLink, FileText, Tag, User } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SearchResultDocument } from "@/lib/omeka/types";
import { cn } from "@/lib/utils";

interface SearchResultCardProps {
  result: SearchResultDocument;
  query: string;
}

function highlightSnippet(snippet: string, terms: string[]): string {
  if (!snippet || terms.length === 0) {
    return snippet;
  }
  return snippet;
}

export function SearchResultCard({ result, query }: SearchResultCardProps) {
  const snippet = highlightSnippet(result.snippet, [query, ...result.matchedTerms]);

  return (
    <article className="group rounded-lg border border-border bg-white p-4 transition-colors hover:border-primary/30 hover:shadow-sm sm:p-5">
      <div className="flex gap-4">
        {result.thumbnailUrl ? (
          <div className="hidden shrink-0 sm:block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={result.thumbnailUrl}
              alt=""
              className="size-20 rounded border border-border object-cover"
            />
          </div>
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h2 className="text-base font-semibold leading-snug text-primary sm:text-lg">
              <Link
                href={`/item/${result.itemId}`}
                className="hover:underline"
              >
                {result.title}
              </Link>
            </h2>
            {result.relevanceScore > 0 ? (
              <Badge variant="outline" className="shrink-0 text-[10px] uppercase">
                Relevant
              </Badge>
            ) : null}
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {result.creator ? (
              <span className="inline-flex items-center gap-1">
                <User className="size-3" aria-hidden="true" />
                {result.creator}
              </span>
            ) : null}
            {result.date ? (
              <span className="inline-flex items-center gap-1">
                <Calendar className="size-3" aria-hidden="true" />
                {result.date}
              </span>
            ) : null}
            {result.documentType ? (
              <span className="inline-flex items-center gap-1">
                <FileText className="size-3" aria-hidden="true" />
                {result.documentType}
              </span>
            ) : null}
            {result.identifier ? (
              <span className="font-mono text-[11px]">{result.identifier}</span>
            ) : null}
          </div>

          {result.isPartOf ? (
            <p className="mt-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">Collection:</span>{" "}
              {result.isPartOf}
            </p>
          ) : null}

          {snippet ? (
            <p className="mt-3 text-sm leading-relaxed text-foreground/85">
              {snippet}
            </p>
          ) : null}

          {result.matchedTerms.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <Tag className="size-3 text-muted-foreground" aria-hidden="true" />
              {result.matchedTerms.slice(0, 6).map((term) => (
                <Badge
                  key={term}
                  variant="secondary"
                  className={cn(
                    "text-[10px] font-normal",
                    term.toLowerCase() === query.toLowerCase() && "border-primary/30",
                  )}
                >
                  {term}
                </Badge>
              ))}
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href={`/item/${result.itemId}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              View details
            </Link>
            <a
              href={result.edisonDigitalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
            >
              Open on edisondigital.rutgers.edu
              <ExternalLink className="size-3" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}
