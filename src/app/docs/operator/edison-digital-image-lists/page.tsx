import Link from "next/link";

export const metadata = {
  title: "Edison Digital image lists \u00b7 Operator guide",
};

export default function OperatorImageListsPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-10 sm:px-8">
      <nav
        aria-label="Breadcrumb"
        className="text-[12px] text-muted-foreground"
      >
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/" className="hover:text-foreground hover:underline">
              Home
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link
              href="/upload"
              className="hover:text-foreground hover:underline"
            >
              Upload
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li className="text-foreground" aria-current="page">
            Image lists
          </li>
        </ol>
      </nav>

      <article className="prose mt-4 max-w-none text-foreground">
        <h1 className="text-2xl font-semibold">
          Generating image file lists from edisondigital.rutgers.edu
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Use this guide to assemble the per-image CSV used by the Edison
          automation upload pipeline. Run it once per item set before uploading
          the images into the transcription workbench.
        </p>

        <Section title="1. Export the Omeka CSV">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              In the Omeka admin, open the item set that contains the items
              you need.
            </li>
            <li>
              Switch to <strong>Edit</strong> mode to get links to media files
              in an item set.
            </li>
            <li>
              Open <strong>Advanced Search</strong> and set the filter to{" "}
              <code className="font-mono">{`"In item set" [Item Set ID]`}</code>
              .
            </li>
            <li>
              Run the search. At the bottom of the search-result screen there
              will be a link to download the CSV.
            </li>
            <li>
              Download and save the CSV locally; it should include the{" "}
              <code className="font-mono">o:media/file</code> column (multiple
              values separated by <code className="font-mono">|</code>).
            </li>
          </ol>
        </Section>

        <Section title="2. Split the multi-valued media column with Gemini">
          <p className="text-sm leading-relaxed">
            Open Gemini and upload the CSV from step 1. Use the following
            prompt verbatim:
          </p>
          <blockquote className="mt-2 border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              I have uploaded a CSV file. Inside it, one of the columns{" "}
              <code className="font-mono">o:media/file</code> has multiple
              values separated by a <code className="font-mono">|</code>{" "}
              character. Please produce a new downloadable CSV with one row
              per value in the <code className="font-mono">o:media/file</code>{" "}
              column. Keep only the following columns in this order:
            </p>
            <ol className="mt-2 list-decimal space-y-1 pl-5 font-mono text-[13px]">
              <li>o:id</li>
              <li>dcterms:identifier</li>
              <li>dcterms:title</li>
              <li>dcterms:date</li>
              <li>dcterms:source</li>
              <li>o:media/file</li>
            </ol>
          </blockquote>
          <p className="mt-2 text-sm leading-relaxed">
            Download the resulting CSV. Each row now represents a single image
            file and is ready to drive a batched upload.
          </p>
        </Section>

        <Section title="3. Upload images into the workbench">
          <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
            <li>
              Pick a Folder ID (e.g. <code className="font-mono">D9032-F</code>
              ) and a Doc ID prefix.
            </li>
            <li>
              Rename each image so its filename matches the Doc ID convention
              (<code className="font-mono">D9032-00001</code>,{" "}
              <code className="font-mono">D9032-00002</code>, ...).
            </li>
            <li>
              Drag the renamed images into the{" "}
              <Link
                href="/upload"
                className="text-foreground underline hover:no-underline"
              >
                upload form
              </Link>
              . Pick the document type:
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>
                  <strong>Standard document</strong> for letters, telegrams,
                  and similar correspondence.
                </li>
                <li>
                  <strong>Project notebook</strong> for laboratory project
                  logs.
                </li>
              </ul>
            </li>
            <li>
              Confirm transcription and metadata extraction in the results
              panel.
            </li>
          </ol>
        </Section>
      </article>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 text-foreground">{children}</div>
    </section>
  );
}
