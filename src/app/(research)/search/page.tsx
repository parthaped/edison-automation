export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { SearchBar } from "@/components/research/search-bar";
import { SearchFilters } from "@/components/research/search-filters";
import { SearchResultCard } from "@/components/research/search-result-card";
import { Badge } from "@/components/ui/badge";
import { SearchIndexUnavailableError } from "@/lib/search/index-store";
import { semanticSearch } from "@/lib/search/semantic-search";
import { buildSearchUrl, parseSearchPageParams } from "@/lib/search/search-params";
import { hasSearchCriteria } from "@/lib/search/search-filters";

export const metadata: Metadata = {
  title: "Search · Edison Papers Research Platform",
};

interface SearchPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const filters = parseSearchPageParams(params);
  const page = filters.page ?? 1;
  const query = filters.query ?? "";

  if (!hasSearchCriteria(filters)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
        <h1 className="text-2xl font-semibold">Enter a search query</h1>
        <p className="mt-2 text-muted-foreground">
          Search across Edison Papers metadata and transcriptions, or use advanced
          filters to narrow by time period, type, and more.
        </p>
        <div className="mt-8">
          <SearchBar autoFocus />
        </div>
        <Link
          href="/search/advanced"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <Search className="size-4" aria-hidden="true" />
          Advanced search
        </Link>
      </div>
    );
  }

  let results;
  try {
    results = await semanticSearch({
      ...filters,
      page,
      perPage: 20,
    });
  } catch (error) {
    if (error instanceof SearchIndexUnavailableError) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h1 className="text-2xl font-semibold">Search index unavailable</h1>
          <p className="mt-2 text-muted-foreground">{error.message}</p>
          <p className="mt-4 text-sm text-muted-foreground">
            You can still browse the authoritative catalog at{" "}
            <a
              href="https://edisondigital.rutgers.edu"
              className="text-primary hover:underline"
              target="_blank"
              rel="noreferrer"
            >
              edisondigital.rutgers.edu
            </a>
            .
          </p>
        </div>
      );
    }
    throw error;
  }

  const totalPages = Math.max(1, Math.ceil(results.totalResults / results.perPage));
  const heading = query
    ? `${results.totalResults.toLocaleString()} result${results.totalResults === 1 ? "" : "s"} for “${query}”`
    : `${results.totalResults.toLocaleString()} matching document${results.totalResults === 1 ? "" : "s"}`;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SearchBar defaultValue={query} size="compact" />
        <Link
          href="/search/advanced"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          <Search className="size-4" aria-hidden="true" />
          Advanced search
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold sm:text-xl">{heading}</h1>
        {query ? (
          <Badge variant="secondary" className="gap-1">
            Context-aware
          </Badge>
        ) : null}
      </div>

      {results.expandedTerms.length > 0 ? (
        <p className="mb-6 text-xs text-muted-foreground">
          Also searching related terms:{" "}
          {results.expandedTerms.slice(0, 8).join(", ")}
          {results.expandedTerms.length > 8 ? "…" : ""}
        </p>
      ) : null}

      {results.indexBuiltAt ? (
        <p className="mb-6 text-xs text-muted-foreground">
          Index built {new Date(results.indexBuiltAt).toLocaleString()}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[260px_minmax(0,1fr)]">
        <SearchFilters
          facets={results.facets}
          activeFilters={filters}
          query={query}
        />

        <div className="space-y-4">
          {results.results.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-white p-10 text-center">
              <p className="text-base font-medium">No documents found</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Try broader keywords, remove filters, or search on{" "}
                <a
                  href="https://edisondigital.rutgers.edu"
                  className="text-primary hover:underline"
                  target="_blank"
                  rel="noreferrer"
                >
                  edisondigital.rutgers.edu
                </a>
                .
              </p>
            </div>
          ) : (
            results.results.map((result) => (
              <SearchResultCard key={result.itemId} result={result} query={query} />
            ))
          )}

          {totalPages > 1 ? (
            <nav
              aria-label="Search results pagination"
              className="flex items-center justify-between border-t border-border pt-4"
            >
              {page > 1 ? (
                <Link
                  href={buildSearchUrl({ ...filters, page: page - 1 })}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              {page < totalPages ? (
                <Link
                  href={buildSearchUrl({ ...filters, page: page + 1 })}
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Next
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Link>
              ) : (
                <span />
              )}
            </nav>
          ) : null}
        </div>
      </div>
    </div>
  );
}
