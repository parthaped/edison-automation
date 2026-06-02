import {
  formatGloc,
  normalizeMetadata,
  normalizeMetadataValue,
} from "./metadata-normalize";
import type { MetadataExtraction } from "./types";

export const TAEP_INDEX_COLUMNS = [
  "Timestamp",
  "GLOC",
  "DocID",
  "Document Type",
  "Date",
  "Author(s)",
  "Recipient(s)",
  "Name(s) Mentioned",
  "Subjects",
  "Places",
  "Image Filename(s)",
  "Comments",
] as const;

const CSV_LINE_TERMINATOR = "\n";

function serializeCell(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  const escaped = str.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

function joinSemicolon(values: string[] | undefined): string {
  if (!values || values.length === 0) return "";
  return values.join("; ");
}

export function buildTaepIndexRow(
  metadata: MetadataExtraction,
  exportedAt: string,
): Record<(typeof TAEP_INDEX_COLUMNS)[number], string> {
  const normalized = normalizeMetadata(metadata);
  return {
    Timestamp: exportedAt,
    GLOC: formatGloc(normalized.folderId),
    DocID: normalized.documentId,
    "Document Type": normalized.documentType,
    Date: normalized.date,
    "Author(s)": joinSemicolon(normalized.authors),
    "Recipient(s)": joinSemicolon(normalized.recipients),
    "Name(s) Mentioned": joinSemicolon(normalized.mentionedNames),
    Subjects: joinSemicolon(normalized.subjects),
    Places: joinSemicolon(normalized.places),
    "Image Filename(s)": joinSemicolon(normalized.imageNames),
    Comments: normalizeMetadataValue(normalized.comments),
  };
}

export function buildTaepIndexCsv(
  rows: Array<Record<(typeof TAEP_INDEX_COLUMNS)[number], string>>,
): string {
  const header = TAEP_INDEX_COLUMNS.join(",");
  const body = rows.map((row) =>
    TAEP_INDEX_COLUMNS.map((column) => serializeCell(row[column])).join(","),
  );
  return [header, ...body].join(CSV_LINE_TERMINATOR);
}
