import Link from "next/link";
import type { SearchResponse } from "@/lib/omeka/types";
import type { SearchFilterParams } from "@/lib/search/index-types";
import { buildSearchUrl } from "@/lib/search/search-params";
import { cn } from "@/lib/utils";

interface SearchFiltersProps {
  facets: SearchResponse["facets"];
  activeFilters: SearchFilterParams;
  query?: string;
}

function FilterChip({
  label,
  href,
}: {
  label: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/15"
    >
      {label} ×
    </Link>
  );
}

function FacetList({
  title,
  entries,
  buildHref,
  activeValue,
}: {
  title: string;
  entries: Array<{ value: string; count: number }>;
  buildHref: (value: string) => string;
  activeValue?: string;
}) {
  if (entries.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <ul className="mt-3 space-y-1">
        {entries.map((facet) => (
          <li key={facet.value}>
            <Link
              href={buildHref(facet.value)}
              className={cn(
                "flex items-center justify-between rounded px-2 py-1.5 text-sm transition-colors hover:bg-muted",
                activeValue === facet.value && "bg-primary/10 font-medium text-primary",
              )}
            >
              <span className="line-clamp-2 pr-2">{facet.value}</span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {facet.count}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function SearchFilters({
  facets,
  activeFilters,
  query,
}: SearchFiltersProps) {
  const baseParams = { ...activeFilters, query };

  const clearFilter = (omit: keyof SearchFilterParams): string =>
    buildSearchUrl({ ...baseParams, [omit]: undefined, page: 1 });

  const withFilter = (
    key: keyof SearchFilterParams,
    value: string,
  ): string => buildSearchUrl({ ...baseParams, [key]: value, page: 1 });

  const activeChips: Array<{ label: string; href: string }> = [];

  if (activeFilters.documentType) {
    activeChips.push({
      label: `Type: ${activeFilters.documentType}`,
      href: clearFilter("documentType"),
    });
  }
  if (activeFilters.collection) {
    activeChips.push({
      label: `Collection: ${activeFilters.collection.slice(0, 40)}`,
      href: clearFilter("collection"),
    });
  }
  if (activeFilters.yearFrom !== undefined || activeFilters.yearTo !== undefined) {
    activeChips.push({
      label: `Years: ${activeFilters.yearFrom ?? "…"}–${activeFilters.yearTo ?? "…"}`,
      href: buildSearchUrl({
        ...baseParams,
        yearFrom: undefined,
        yearTo: undefined,
        page: 1,
      }),
    });
  }
  if (activeFilters.decade !== undefined) {
    activeChips.push({
      label: `Decade: ${activeFilters.decade}s`,
      href: clearFilter("decade"),
    });
  }
  if (activeFilters.author) {
    activeChips.push({
      label: `Author: ${activeFilters.author}`,
      href: clearFilter("author"),
    });
  }
  if (activeFilters.recipient) {
    activeChips.push({
      label: `Recipient: ${activeFilters.recipient}`,
      href: clearFilter("recipient"),
    });
  }
  if (activeFilters.subject) {
    activeChips.push({
      label: `Subject: ${activeFilters.subject}`,
      href: clearFilter("subject"),
    });
  }
  if (activeFilters.place) {
    activeChips.push({
      label: `Place: ${activeFilters.place}`,
      href: clearFilter("place"),
    });
  }
  if (activeFilters.identifier) {
    activeChips.push({
      label: `ID: ${activeFilters.identifier}`,
      href: clearFilter("identifier"),
    });
  }

  return (
    <aside className="space-y-6">
      {activeChips.length > 0 ? (
        <div className="rounded-lg border border-border bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Active filters
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {activeChips.map((chip) => (
              <FilterChip key={chip.label} label={chip.label} href={chip.href} />
            ))}
          </div>
          <Link
            href={query ? `/search?q=${encodeURIComponent(query)}` : "/search/advanced"}
            className="mt-3 inline-block text-xs text-primary hover:underline"
          >
            Clear all filters
          </Link>
        </div>
      ) : null}

      <FacetList
        title="Document type"
        entries={facets.documentTypes}
        activeValue={activeFilters.documentType}
        buildHref={(value) => withFilter("documentType", value)}
      />

      <FacetList
        title="Collection / series"
        entries={facets.collections}
        activeValue={activeFilters.collection}
        buildHref={(value) => withFilter("collection", value)}
      />

      <FacetList
        title="Decade"
        entries={facets.decades}
        activeValue={
          activeFilters.decade !== undefined
            ? String(activeFilters.decade)
            : undefined
        }
        buildHref={(value) =>
          buildSearchUrl({
            ...baseParams,
            decade: Number(value),
            page: 1,
          })
        }
      />

      <FacetList
        title="Subject"
        entries={facets.subjects}
        activeValue={activeFilters.subject}
        buildHref={(value) => withFilter("subject", value)}
      />

      <FacetList
        title="Place"
        entries={facets.places}
        activeValue={activeFilters.place}
        buildHref={(value) => withFilter("place", value)}
      />

      <FacetList
        title="Author"
        entries={facets.creators}
        activeValue={activeFilters.author}
        buildHref={(value) => withFilter("author", value)}
      />

      <div className="rounded-lg border border-border bg-white p-4 text-xs text-muted-foreground">
        <p>
          Also search on{" "}
          <a
            href="https://edisondigital.rutgers.edu"
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            edisondigital.rutgers.edu
          </a>{" "}
          for the authoritative Omeka catalog when the local index may be stale.
        </p>
      </div>
    </aside>
  );
}
