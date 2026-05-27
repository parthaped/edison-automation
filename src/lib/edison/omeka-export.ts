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

  return [header, ...body].join("\n");
}

export function buildOmekaApiPayload(
  metadata: MetadataExtraction,
  transcription: TranscriptionRun,
) {
  return {
    "dcterms:identifier": [{ type: "literal", property_id: 10, "@value": metadata.documentId }],
    "dcterms:isPartOf": [{ type: "literal", property_id: 33, "@value": metadata.folderId }],
    "dcterms:type": [{ type: "literal", property_id: 8, "@value": metadata.documentType }],
    "dcterms:date": [{ type: "literal", property_id: 7, "@value": metadata.date }],
    "dcterms:creator": metadata.authors.map((author) => ({
      type: "literal",
      property_id: 2,
      "@value": author,
    })),
    "bibo:recipient": metadata.recipients.map((recipient) => ({
      type: "literal",
      property_id: 77,
      "@value": recipient,
    })),
    "dcterms:relation": metadata.mentionedNames.map((name) => ({
      type: "literal",
      property_id: 13,
      "@value": name,
    })),
    "dcterms:subject": metadata.subjects.map((subject) => ({
      type: "literal",
      property_id: 3,
      "@value": subject,
    })),
    "dcterms:description": [
      {
        type: "html",
        property_id: 4,
        "@value": transcription.diplomaticText,
      },
    ],
  };
}
