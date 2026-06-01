import type { MetadataExtraction, TranscriptionRun } from "./types";

// Omeka CSV Import column shape used by edisondigital.rutgers.edu. Headers are
// Omeka property terms (`o:id`, `o:media/file`) and Dublin Core terms; the
// resulting file imports cleanly through the Omeka S CSV Import module.
//
// Multivalue fields (`dcterms:creator`, `dcterms:subject`, `o:media/file`) are
// joined with `|` to match the separator the operator doc already uses when
// re-splitting `o:media/file` from an Edison Digital export.
const EXPORT_COLUMNS = [
  "o:id",
  "dcterms:identifier",
  "dcterms:title",
  "dcterms:type",
  "dcterms:date",
  "dcterms:creator",
  "dcterms:subject",
  "dcterms:description",
  "dcterms:source",
  "o:media/file",
] as const;

const CSV_LINE_TERMINATOR = "\n";
const MULTIVALUE_SEPARATOR = "|";

// Coerce to string before escaping so an older record missing a newer field
// (e.g. `title` on records persisted before that field existed) renders as a
// blank cell instead of throwing inside `.replace`.
function serializeCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function joinValues(values: string[] | undefined): string {
  if (!values || values.length === 0) return "";
  return values.join(MULTIVALUE_SEPARATOR);
}

export function buildExportCsvRow(
  metadata: MetadataExtraction,
  transcription: TranscriptionRun,
): Record<(typeof EXPORT_COLUMNS)[number], string> {
  return {
    "o:id": "",
    "dcterms:identifier": metadata.documentId,
    "dcterms:title": metadata.title,
    "dcterms:type": metadata.documentType,
    "dcterms:date": metadata.date,
    "dcterms:creator": joinValues(metadata.authors),
    "dcterms:subject": joinValues(metadata.subjects),
    "dcterms:description": transcription.diplomaticText,
    "dcterms:source": metadata.folderId,
    "o:media/file": joinValues(metadata.imageNames),
  };
}

export function buildExportCsv(
  rows: Array<Record<(typeof EXPORT_COLUMNS)[number], string>>,
): string {
  const header = EXPORT_COLUMNS.join(",");
  const body = rows.map((row) =>
    EXPORT_COLUMNS.map((column) => serializeCell(row[column])).join(","),
  );

  return [header, ...body].join(CSV_LINE_TERMINATOR);
}
