import {
  buildCatalogTitle,
  buildIsPartOf,
  normalizeMetadata,
} from "./metadata-normalize";
import type { MetadataExtraction, TranscriptionRun } from "./types";

// Omeka S CSV Import column shape aligned with edisondigital.rutgers.edu.
const EXPORT_COLUMNS = [
  "o:id",
  "dcterms:identifier",
  "dcterms:title",
  "dcterms:type",
  "dcterms:date",
  "dcterms:creator",
  "bibo:recipient",
  "dcterms:relation",
  "dcterms:subject",
  "dcterms:coverage",
  "dcterms:isPartOf",
  "scripto:transcription",
  "o:media/file",
] as const;

const CSV_LINE_TERMINATOR = "\n";
const MULTIVALUE_SEPARATOR = "|";

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
  const normalized = normalizeMetadata(metadata);
  return {
    "o:id": "",
    "dcterms:identifier": normalized.documentId,
    "dcterms:title": buildCatalogTitle(normalized.documentId, normalized),
    "dcterms:type": normalized.documentType,
    "dcterms:date": normalized.date,
    "dcterms:creator": joinValues(normalized.authors),
    "bibo:recipient": joinValues(normalized.recipients),
    "dcterms:relation": joinValues(normalized.mentionedNames),
    "dcterms:subject": joinValues(normalized.subjects),
    "dcterms:coverage": joinValues(normalized.places),
    "dcterms:isPartOf": buildIsPartOf(normalized.folderId, normalized.date),
    "scripto:transcription": transcription.diplomaticText,
    "o:media/file": joinValues(normalized.imageNames),
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
