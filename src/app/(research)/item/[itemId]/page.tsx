import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  FileText,
  Tag,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IiifViewer } from "@/components/research/iiif-viewer";
import {
  fetchOmekaItem,
  getFirstValue,
  getItemPublicUrl,
  getValueStrings,
  itemToDocumentFields,
} from "@/lib/omeka/client";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ itemId: string }>;
}): Promise<Metadata> {
  const { itemId } = await params;
  try {
    const item = await fetchOmekaItem(Number(itemId));
    const title =
      getFirstValue(item["dcterms:title"]) ||
      item["o:title"] ||
      `Item ${itemId}`;
    return { title: `${title} · Edison Papers` };
  } catch {
    return { title: "Document · Edison Papers" };
  }
}

interface ItemPageProps {
  params: Promise<{ itemId: string }>;
}

export default async function ItemPage({ params }: ItemPageProps) {
  const { itemId: itemIdParam } = await params;
  const itemId = Number(itemIdParam);
  if (!Number.isFinite(itemId)) {
    notFound();
  }

  let item;
  try {
    item = await fetchOmekaItem(itemId);
  } catch {
    notFound();
  }

  const fields = itemToDocumentFields(item);
  const description = getFirstValue(item["dcterms:description"]);
  const transcription = getFirstValue(item["scripto:transcription"]);
  const subjects = getValueStrings(item["dcterms:subject"]);
  const publicUrl = getItemPublicUrl(itemId);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to search
      </Link>

      <article className="mt-6 rounded-lg border border-border bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
          {fields.title}
        </h1>

        {fields.iiifManifestUrl ? (
          <section className="mt-6">
            <IiifViewer
              manifestUrl={fields.iiifManifestUrl}
              thumbnailUrl={fields.thumbnailUrl}
              edisonDigitalUrl={publicUrl}
              title="Document pages"
            />
          </section>
        ) : fields.thumbnailUrl ? (
          <div className="mt-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={fields.thumbnailUrl}
              alt=""
              className="mx-auto max-h-64 rounded border border-border object-contain"
            />
          </div>
        ) : null}

        <div className="mt-6 min-w-0">
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              {fields.creator ? (
                <div>
                  <dt className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <User className="size-3" aria-hidden="true" />
                    Creator
                  </dt>
                  <dd className="mt-0.5">{fields.creator}</dd>
                </div>
              ) : null}
              {fields.date ? (
                <div>
                  <dt className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Calendar className="size-3" aria-hidden="true" />
                    Date
                  </dt>
                  <dd className="mt-0.5">{fields.date}</dd>
                </div>
              ) : null}
              {fields.documentType ? (
                <div>
                  <dt className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <FileText className="size-3" aria-hidden="true" />
                    Type
                  </dt>
                  <dd className="mt-0.5">{fields.documentType}</dd>
                </div>
              ) : null}
              {fields.identifier ? (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Identifier
                  </dt>
                  <dd className="mt-0.5 font-mono text-xs">{fields.identifier}</dd>
                </div>
              ) : null}
              {fields.isPartOf ? (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Collection / series
                  </dt>
                  <dd className="mt-0.5">{fields.isPartOf}</dd>
                </div>
              ) : null}
            </dl>

            {subjects.length > 0 ? (
              <div className="mt-5">
                <p className="inline-flex items-center gap-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <Tag className="size-3" aria-hidden="true" />
                  Subjects
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {subjects.map((subject) => (
                    <Badge key={subject} variant="secondary">
                      {subject}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <Button
                render={
                  <a href={publicUrl} target="_blank" rel="noopener noreferrer" />
                }
              >
                View on edisondigital.rutgers.edu
                <ExternalLink className="size-4" aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                render={
                  <Link href={`/search?q=${encodeURIComponent(fields.title)}`} />
                }
              >
                Find similar documents
              </Button>
            </div>
          </div>

        {description ? (
          <section className="mt-8 border-t border-border pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </h2>
            <p className="mt-3 text-sm leading-relaxed whitespace-pre-wrap">
              {description}
            </p>
          </section>
        ) : null}

        {transcription ? (
          <section className="mt-8 border-t border-border pt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Transcription excerpt
            </h2>
            <div className="mt-3 rounded-md bg-muted/40 p-4 font-mono text-sm leading-relaxed whitespace-pre-wrap">
              {transcription.slice(0, 3000)}
              {transcription.length > 3000 ? "…" : ""}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {fields.iiifManifestUrl
                ? "Full transcription and additional images are available on edisondigital.rutgers.edu."
                : "Full transcription and page images are available on edisondigital.rutgers.edu."}
            </p>
          </section>
        ) : null}
      </article>
    </div>
  );
}
