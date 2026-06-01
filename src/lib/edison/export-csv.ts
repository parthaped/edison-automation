import type { MetadataExtraction, TranscriptionRun } from "./types";

// Plain RFC-4180-style CSV (comma-delimited, double-quote escaping, LF line
// endings). Columns are ordered to mirror the Dublin Core fields indexed on
// edisondigital.rutgers.edu (identifier, title, type, date, creator, subject).
const EXPORT_COLUMNS = [
  "Doc ID",
  "Folder ID",
  "Title",
  "Document Type",
  "Date",
  "Author(s)",
  "Recipient(s)",
  "Name Mentions",
  "Subjects",
  "Image name(s)",
  "Confidence",
  "Transcription",
] as const;

const CSV_LINE_TERMINATOR = "\n";

function serializeCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function joinValues(values: string[]): string {
  return values.join("; ");
}

export function buildExportCsvRow(
  metadata: MetadataExtraction,
  transcription: TranscriptionRun,
): Record<(typeof EXPORT_COLUMNS)[number], string> {
  return {
    "Doc ID": metadata.documentId,
    "Folder ID": metadata.folderId,
    Title: metadata.title,
    "Document Type": metadata.documentType,
    Date: metadata.date,
    "Author(s)": joinValues(metadata.authors),
    "Recipient(s)": joinValues(metadata.recipients),
    "Name Mentions": joinValues(metadata.mentionedNames),
    Subjects: joinValues(metadata.subjects),
    "Image name(s)": joinValues(metadata.imageNames),
    Confidence: metadata.confidence,
    Transcription: transcription.diplomaticText,
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
