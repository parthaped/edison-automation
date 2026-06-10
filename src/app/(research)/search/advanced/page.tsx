export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { AdvancedSearchForm } from "@/components/research/advanced-search-form";
import { SearchIndexUnavailableError, getSearchIndex } from "@/lib/search/index-store";
import { parseSearchPageParams } from "@/lib/search/search-params";

export const metadata: Metadata = {
  title: "Advanced Search · Edison Papers Research Platform",
};

interface AdvancedSearchPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function AdvancedSearchPage({
  searchParams,
}: AdvancedSearchPageProps) {
  const params = await searchParams;
  const defaults = parseSearchPageParams(params);

  let manifestFacets = null;
  try {
    const loaded = await getSearchIndex();
    manifestFacets = loaded.manifest.facets;
  } catch (error) {
    if (!(error instanceof SearchIndexUnavailableError)) {
      throw error;
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Advanced search</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Narrow Edison Papers records by keywords, time period, document type,
          people, places, and identifiers — modeled on{" "}
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
        {!manifestFacets ? (
          <p className="mt-3 text-sm text-amber-700">
            Search index not loaded — facet dropdowns may be empty until{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">npm run search:build</code>{" "}
            is run.
          </p>
        ) : null}
      </div>

      <AdvancedSearchForm defaultValues={defaults} manifestFacets={manifestFacets} />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/" className="text-primary hover:underline">
          Back to home
        </Link>
      </p>
    </div>
  );
}
