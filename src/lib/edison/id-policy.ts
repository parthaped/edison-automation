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
