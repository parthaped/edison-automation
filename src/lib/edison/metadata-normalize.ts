import type { ConfidenceBucket, MetadataExtraction } from "./types";
import type { TranscribedMetadata } from "./transcribe";

export const TAEP_DOCUMENT_TYPES = [
  "Letter",
  "Memorandum",
  "Telegram",
  "Report",
  "Publication",
  "Payroll Record",
  "Minutes",
  "Miscellaneous",
  "Questionnaire",
  "List",
  "Clippings",
  "Account",
  "Clipping",
  "Invitation",
  "Instructions",
  "Technical Note",
  "Notebook page",
  "Ledger",
  "Legal document",
  "Financial statement",
  "Drawing",
  "Printed material",
] as const;

const LEGACY_DOCUMENT_TYPE_MAP: Record<string, string> = {
  correspondence: "Letter",
  telegram: "Telegram",
  "notebook page": "Notebook page",
  ledger: "Ledger",
  memorandum: "Memorandum",
  "legal document": "Legal document",
  "financial statement": "Financial statement",
  drawing: "Drawing",
  "printed material": "Printed material",
  unknown: "",
};

export function normalizeMetadataValue(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim();
  if (trimmed.length === 0) return "";
  if (trimmed.toLowerCase() === "unknown") return "";
  return trimmed;
}

export function normalizeStringArray(values: string[] | undefined): string[] {
  if (!values) return [];
  return values
    .map((value) => normalizeMetadataValue(value))
    .filter((value) => value.length > 0);
}

export function mapLegacyDocumentType(documentType: string): string {
  const normalized = normalizeMetadataValue(documentType);
  if (normalized.length === 0) return "";
  const mapped = LEGACY_DOCUMENT_TYPE_MAP[normalized.toLowerCase()];
  return mapped ?? normalized;
}

export function formatGloc(folderId: string): string {
  const trimmed = normalizeMetadataValue(folderId);
  if (trimmed.length === 0) return "";
  return trimmed.endsWith("-F") ? trimmed.slice(0, -2) : trimmed;
}

function yearFromDate(date: string): string | undefined {
  const match = date.match(/^(\d{4})/);
  return match?.[1];
}

export function buildIsPartOf(folderId: string, date: string): string {
  const gloc = formatGloc(folderId);
  if (gloc.length === 0) return "";
  const year = yearFromDate(normalizeMetadataValue(date));
  if (year) {
    return `[${gloc}-F] Document File Series -- ${year}`;
  }
  return `[${gloc}-F] Document File Series`;
}

function formatTitleDate(date: string): string {
  const normalized = normalizeMetadataValue(date);
  if (normalized.length === 0) return "";
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const monthIndex = Number(month) - 1;
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const monthName = monthNames[monthIndex];
    if (monthName) {
      return `${monthName} ${Number(day)}, ${year}`;
    }
  }
  return normalized;
}

export function buildCatalogTitle(
  documentId: string,
  metadata: Pick<
    MetadataExtraction,
    "documentType" | "date" | "authors" | "recipients" | "title"
  >,
): string {
  const docType = mapLegacyDocumentType(metadata.documentType);
  const authors = normalizeStringArray(metadata.authors);
  const recipients = normalizeStringArray(metadata.recipients);
  const formattedDate = formatTitleDate(metadata.date);

  let descriptive = normalizeMetadataValue(metadata.title);
  if (descriptive.startsWith(`[${documentId}],`)) {
    descriptive = descriptive.slice(`[${documentId}],`.length).trim();
  }

  if (docType === "Letter" && authors.length > 0 && recipients.length > 0) {
    const from = authors.join("; ");
    const to = recipients.join("; ");
    descriptive = formattedDate
      ? `Letter from ${from} to ${to}, ${formattedDate}`
      : `Letter from ${from} to ${to}`;
  } else if (descriptive.length === 0) {
    descriptive = "Untitled";
  }

  return `[${documentId}], ${descriptive}`;
}

export function normalizeMetadata(
  metadata: MetadataExtraction,
): MetadataExtraction {
  const documentType = mapLegacyDocumentType(metadata.documentType);
  const date = normalizeMetadataValue(metadata.date);
  const title = normalizeMetadataValue(metadata.title);
  const comments = normalizeMetadataValue(metadata.comments);

  const normalized: MetadataExtraction = {
    ...metadata,
    title:
      title.length > 0
        ? title
        : buildCatalogTitle(metadata.documentId, {
            ...metadata,
            documentType,
            date,
          }),
    documentType,
    date,
    authors: normalizeStringArray(metadata.authors),
    recipients: normalizeStringArray(metadata.recipients),
    mentionedNames: normalizeStringArray(metadata.mentionedNames),
    subjects: normalizeStringArray(metadata.subjects),
    places: normalizeStringArray(metadata.places),
    imageNames: normalizeStringArray(metadata.imageNames),
    comments: comments.length > 0 ? comments : undefined,
  };

  return normalized;
}

export function buildMetadataExtraction(input: {
  folderId: string;
  documentId: string;
  transcribed?: Partial<TranscribedMetadata>;
  fallbackTitle?: string;
  imageNames: string[];
  confidence: ConfidenceBucket;
}): MetadataExtraction {
  return normalizeMetadata({
    folderId: input.folderId,
    documentId: input.documentId,
    title: input.transcribed?.title?.trim() || input.fallbackTitle || "",
    documentType: input.transcribed?.documentType || "",
    date: input.transcribed?.date || "",
    authors: input.transcribed?.authors ?? [],
    recipients: input.transcribed?.recipients ?? [],
    mentionedNames: input.transcribed?.mentionedNames ?? [],
    subjects: input.transcribed?.subjects ?? [],
    places: input.transcribed?.places ?? [],
    comments: input.transcribed?.comments,
    imageNames: input.imageNames,
    confidence: input.confidence,
  });
}
