import type { MetadataExtraction, TranscriptionRun } from "./types";

const OMEKA_COLUMNS = [
  "Folder ID",
  "Doc ID",
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

const CSV_LINE_TERMINATOR = "\r\n";

function serializeCell(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function joinValues(values: string[]): string {
  return values.length > 0 ? values.join("; ") : "Unknown";
}

export function buildOmekaCsvRow(
  metadata: MetadataExtraction,
  transcription: TranscriptionRun,
): Record<(typeof OMEKA_COLUMNS)[number], string> {
  return {
    "Folder ID": metadata.folderId,
    "Doc ID": metadata.documentId,
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

export function buildOmekaCsv(
  rows: Array<Record<(typeof OMEKA_COLUMNS)[number], string>>,
): string {
  const header = OMEKA_COLUMNS.join(",");
  const body = rows.map((row) =>
    OMEKA_COLUMNS.map((column) => serializeCell(row[column])).join(","),
  );

  return [header, ...body, ""].join(CSV_LINE_TERMINATOR);
}
