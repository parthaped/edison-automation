"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SearchIndexManifestFacets } from "@/lib/omeka/types";
import type { SearchFilterParams } from "@/lib/search/index-types";
import { buildSearchUrl } from "@/lib/search/search-params";
import { Button } from "@/components/ui/button";

const fieldClassName =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs";
const labelClassName = "text-sm font-medium leading-none";

interface AdvancedSearchFormProps {
  defaultValues?: SearchFilterParams;
  manifestFacets?: SearchIndexManifestFacets | null;
  compact?: boolean;
}

export function AdvancedSearchForm({
  defaultValues = {},
  manifestFacets,
  compact = false,
}: AdvancedSearchFormProps) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultValues.query ?? "");
  const [yearFrom, setYearFrom] = useState(
    defaultValues.yearFrom !== undefined ? String(defaultValues.yearFrom) : "",
  );
  const [yearTo, setYearTo] = useState(
    defaultValues.yearTo !== undefined ? String(defaultValues.yearTo) : "",
  );
  const [decade, setDecade] = useState(
    defaultValues.decade !== undefined ? String(defaultValues.decade) : "",
  );
  const [documentType, setDocumentType] = useState(defaultValues.documentType ?? "");
  const [collection, setCollection] = useState(defaultValues.collection ?? "");
  const [author, setAuthor] = useState(defaultValues.author ?? "");
  const [recipient, setRecipient] = useState(defaultValues.recipient ?? "");
  const [subject, setSubject] = useState(defaultValues.subject ?? "");
  const [place, setPlace] = useState(defaultValues.place ?? "");
  const [identifier, setIdentifier] = useState(defaultValues.identifier ?? "");

  function parseOptionalInt(value: string): number | undefined {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(
      buildSearchUrl({
        query: query.trim() || undefined,
        yearFrom: parseOptionalInt(yearFrom),
        yearTo: parseOptionalInt(yearTo),
        decade: parseOptionalInt(decade),
        documentType: documentType.trim() || undefined,
        collection: collection.trim() || undefined,
        author: author.trim() || undefined,
        recipient: recipient.trim() || undefined,
        subject: subject.trim() || undefined,
        place: place.trim() || undefined,
        identifier: identifier.trim() || undefined,
      }),
    );
  }

  function handleClear() {
    setQuery("");
    setYearFrom("");
    setYearTo("");
    setDecade("");
    setDocumentType("");
    setCollection("");
    setAuthor("");
    setRecipient("");
    setSubject("");
    setPlace("");
    setIdentifier("");
  }

  const decades = manifestFacets?.decades ?? [];
  const documentTypes = manifestFacets?.documentTypes ?? [];

  return (
    <form
      onSubmit={handleSubmit}
      className={compact ? "space-y-4" : "space-y-6 rounded-lg border border-border bg-white p-6"}
    >
      <div className="space-y-2">
        <label htmlFor="keywords" className={labelClassName}>
          Keywords
        </label>
        <input
          id="keywords"
          name="keywords"
          className={fieldClassName}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='e.g. "crushing ore" or "Menlo Park laboratory"'
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <label htmlFor="yearFrom" className={labelClassName}>
            Year from
          </label>
          <input
            id="yearFrom"
            inputMode="numeric"
            className={fieldClassName}
            value={yearFrom}
            onChange={(event) => setYearFrom(event.target.value)}
            placeholder="1879"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="yearTo" className={labelClassName}>
            Year to
          </label>
          <input
            id="yearTo"
            inputMode="numeric"
            className={fieldClassName}
            value={yearTo}
            onChange={(event) => setYearTo(event.target.value)}
            placeholder="1882"
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="decade" className={labelClassName}>
            Decade
          </label>
          <select
            id="decade"
            value={decade}
            onChange={(event) => setDecade(event.target.value)}
            className={fieldClassName}
          >
            <option value="">Any decade</option>
            {decades.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.value}s ({entry.count})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="documentType" className={labelClassName}>
            Document type
          </label>
          <select
            id="documentType"
            value={documentType}
            onChange={(event) => setDocumentType(event.target.value)}
            className={fieldClassName}
          >
            <option value="">Any type</option>
            {documentTypes.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.value} ({entry.count})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <label htmlFor="collection" className={labelClassName}>
            Collection / series
          </label>
          <input
            id="collection"
            className={fieldClassName}
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
            placeholder="E2002-F or Document File Series"
            list="collection-suggestions"
          />
          <datalist id="collection-suggestions">
            {(manifestFacets?.collections ?? []).slice(0, 30).map((entry) => (
              <option key={entry.value} value={entry.value} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="author" className={labelClassName}>
            Author
          </label>
          <input
            id="author"
            className={fieldClassName}
            value={author}
            onChange={(event) => setAuthor(event.target.value)}
            placeholder="Edison, Thomas A."
            list="author-suggestions"
          />
          <datalist id="author-suggestions">
            {(manifestFacets?.creators ?? []).slice(0, 30).map((entry) => (
              <option key={entry.value} value={entry.value} />
            ))}
          </datalist>
        </div>
        <div className="space-y-2">
          <label htmlFor="recipient" className={labelClassName}>
            Recipient
          </label>
          <input
            id="recipient"
            className={fieldClassName}
            value={recipient}
            onChange={(event) => setRecipient(event.target.value)}
            placeholder="Recipient name"
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <label htmlFor="subject" className={labelClassName}>
            Subject
          </label>
          <input
            id="subject"
            className={fieldClassName}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="Ore milling"
            list="subject-suggestions"
          />
          <datalist id="subject-suggestions">
            {(manifestFacets?.subjects ?? []).slice(0, 30).map((entry) => (
              <option key={entry.value} value={entry.value} />
            ))}
          </datalist>
        </div>
        <div className="space-y-2">
          <label htmlFor="place" className={labelClassName}>
            Place
          </label>
          <input
            id="place"
            className={fieldClassName}
            value={place}
            onChange={(event) => setPlace(event.target.value)}
            placeholder="Menlo Park"
            list="place-suggestions"
          />
          <datalist id="place-suggestions">
            {(manifestFacets?.places ?? []).slice(0, 30).map((entry) => (
              <option key={entry.value} value={entry.value} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="identifier" className={labelClassName}>
          Identifier / Doc ID
        </label>
        <input
          id="identifier"
          className={fieldClassName}
          value={identifier}
          onChange={(event) => setIdentifier(event.target.value)}
          placeholder="E2002 or D0102AAB"
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="submit">Search</Button>
        <Button type="button" variant="outline" onClick={handleClear}>
          Clear filters
        </Button>
      </div>
    </form>
  );
}
