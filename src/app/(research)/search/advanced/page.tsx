export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { AdvancedSearchForm } from "@/components/research/advanced-search-form";
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

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold">Advanced search</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Narrow Edison Papers records by keywords, time period, document type,
          people, places, and identifiers — searched live against{" "}
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

      <AdvancedSearchForm defaultValues={defaults} manifestFacets={null} />

      <p className="mt-6 text-center text-sm text-muted-foreground">
        <Link href="/" className="text-primary hover:underline">
          Back to home
        </Link>
      </p>
    </div>
  );
}
