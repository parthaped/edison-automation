export interface AssignDocumentIdInput {
  folderId?: string;
  providedDocumentId?: string;
  sourceName?: string;
  batchIndex: number;
  existingIds: Set<string>;
  generatedPrefix?: string;
}

export interface AssignedDocumentId {
  documentId: string;
  generated: boolean;
  reason: string;
}

const DOCUMENT_ID_PATTERN = /\b([A-Z]\d{3,5}(?:[A-Z]{0,4})?(?:-\d{3,5})?|[A-Z]\d{4,}[A-Z0-9-]*)\b/i;

export function normalizeIdentifier(value: string): string {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

export function normalizeFolderId(value: string): string {
  const normalized = normalizeIdentifier(value);
  return normalized.endsWith("-F") ? normalized : `${normalized}-F`;
}

export function extractDocumentIdFromName(filename: string): string | undefined {
  const normalizedName = filename.replace(/\.[^.]+$/, "");
  const match = normalizedName.match(DOCUMENT_ID_PATTERN);
  return match ? normalizeIdentifier(match[1]) : undefined;
}

export function generateDocumentId(
  folderId: string | undefined,
  batchIndex: number,
  generatedPrefix = "NEW",
): string {
  const folderBase = folderId
    ? normalizeFolderId(folderId).replace(/-F$/, "")
    : "UNASSIGNED";
  const sequence = String(batchIndex).padStart(5, "0");
  return `${generatedPrefix}-${folderBase}-${sequence}`;
}

export function assignDocumentId(input: AssignDocumentIdInput): AssignedDocumentId {
  const candidates = [
    input.providedDocumentId,
    input.sourceName ? extractDocumentIdFromName(input.sourceName) : undefined,
  ]
    .filter(Boolean)
    .map((candidate) => normalizeIdentifier(candidate as string));

  for (const candidate of candidates) {
    if (!input.existingIds.has(candidate)) {
      return {
        documentId: candidate,
        generated: false,
        reason: "Preserved supplied document identifier.",
      };
    }
  }

  const base = generateDocumentId(
    input.folderId,
    input.batchIndex,
    input.generatedPrefix,
  );
  let generated = base;
  let suffix = 1;
  while (input.existingIds.has(generated)) {
    generated = `${base}-${suffix}`;
    suffix += 1;
  }

  return {
    documentId: generated,
    generated: true,
    reason:
      candidates.length > 0
        ? "Supplied document identifier already exists; generated a collision-free identifier."
        : "No document identifier was supplied; generated a controlled temporary identifier.",
  };
}

export function buildImageFilename(documentId: string, sourceName: string, pageIndex: number): string {
  const imageBase = sourceName
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const page = String(pageIndex + 1).padStart(4, "0");
  return `${normalizeIdentifier(documentId)}/${imageBase || "page"}_${page}.jpg`;
}

// Builds a stable sibling identifier for a sub-document detected inside a
// multi-document PDF. `position` is 0-based: position 0 keeps the base id
// unchanged so a single-document upload's id is identical to the legacy
// (pre-split) behavior. Positions 1+ get alphabetic suffixes that wrap to
// double letters once Z is exhausted, so a PDF with 30 sub-documents still
// produces unambiguous ids (...-Z, -AA, -AB, ...).
export function appendSubDocumentSuffix(baseId: string, position: number): string {
  if (!Number.isInteger(position) || position < 0) {
    throw new Error(`appendSubDocumentSuffix: invalid position ${position}`);
  }
  if (position === 0) return baseId;
  return `${baseId}-${toAlphabeticSuffix(position)}`;
}

function toAlphabeticSuffix(position: number): string {
  // 1 -> "A", 26 -> "Z", 27 -> "AA". Standard spreadsheet-column encoding.
  let n = position;
  let suffix = "";
  while (n > 0) {
    const remainder = (n - 1) % 26;
    suffix = String.fromCharCode(65 + remainder) + suffix;
    n = Math.floor((n - 1) / 26);
  }
  return suffix;
}
