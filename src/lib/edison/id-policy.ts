export interface AssignDocumentIdInput {
  folderId?: string;
  providedDocumentId?: string;
  sourceName?: string;
  batchIndex: number;
  existingIds: Set<string>;
  /**
   * Pre-assigned starting position within the folder. When omitted, the lowest
   * free position is picked. Used by the workflow's assignment pre-pass so
   * concurrently processed files don't all race onto position 0.
   */
  startPosition?: number;
}

export interface AssignedDocumentId {
  documentId: string;
  generated: boolean;
  reason: string;
}

// Matches TAEP-style ids like "E2002AAA" or "E2002AAF1" (folder ending in a
// digit, then a 3-letter position suffix, then an optional numeric attachment
// suffix), AND legacy ids like "D9032-00001" so existing records still
// resolve when their filenames are re-uploaded. The leading letter + digit
// requirement keeps stray filenames like `SECOND.pdf` from being mistaken for
// document ids.
const TAEP_DOCUMENT_ID_PATTERN = /^([A-Z]\d+[A-Z]{3}\d*|[A-Z]\d{3,}-\d{3,})$/;

/**
 * Trims, drops anything outside `[A-Z0-9]`, uppercases, and strips a trailing
 * `-F` because the TAEP convention writes folder ids without that suffix
 * (`E2002`, not `E2002-F`). The `-F` form is reconstructed only inside
 * `buildIsPartOf` for the Omeka export.
 */
export function normalizeFolderId(value: string): string {
  const cleaned = value.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return cleaned.endsWith("F") && cleaned.length > 1 && /[A-Z0-9]F$/.test(cleaned)
    ? // Only strip trailing F when the source clearly contained an explicit
      // "-F" suffix (e.g. "D9032-F" -> "D9032F" after stripping). We detect
      // that by looking at the original input.
      stripTrailingFSuffix(value, cleaned)
    : cleaned;
}

function stripTrailingFSuffix(original: string, cleaned: string): string {
  // Match "<id>-F" or "<id>_F" with optional whitespace.
  return /[-_\s]F\s*$/i.test(original) ? cleaned.slice(0, -1) : cleaned;
}

/**
 * Returns the TAEP-style folder id for a file name when the user didn't
 * provide one. The stem is uppercased and reduced to `[A-Z0-9]`, so
 * `E2002.pdf` -> `E2002`, `1920-General-File.pdf` -> `1920GENERALFILE`.
 */
export function defaultFolderIdFromFileName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const cleaned = stem.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  return cleaned.length > 0 ? cleaned : "UNASSIGNED";
}

/**
 * Attempts to recognise a full TAEP document id embedded in a filename so a
 * file named `E2002AAA.pdf` round-trips to the same record. Returns
 * `undefined` when no recognisable id is present.
 */
export function extractDocumentIdFromName(filename: string): string | undefined {
  const stem = filename.replace(/\.[^.]+$/, "");
  const cleaned = stem.toUpperCase().replace(/[^A-Z0-9-]+/g, "");
  return TAEP_DOCUMENT_ID_PATTERN.test(cleaned) ? cleaned : undefined;
}

/**
 * Converts a 0-based position to the TAEP 3-letter base-26 suffix:
 * `0 -> "AAA"`, `1 -> "AAB"`, `25 -> "AAZ"`, `26 -> "ABA"`, `675 -> "AZZ"`,
 * `676 -> "BAA"`. Beyond `26^3 - 1` the suffix grows to a 4th letter, which
 * stays sortable but exceeds the canonical TAEP form.
 */
export function positionToAlphabeticSuffix(position: number): string {
  if (!Number.isInteger(position) || position < 0) {
    throw new Error(`positionToAlphabeticSuffix: invalid position ${position}`);
  }
  // Pad to 3 letters with leading "A"s by interpreting the position in
  // straight base-26 (A = 0). Once position >= 26^3 the suffix naturally
  // grows a 4th letter.
  let n = position;
  let suffix = "";
  for (let digit = 0; digit < 3 || n > 0; digit += 1) {
    suffix = String.fromCharCode(65 + (n % 26)) + suffix;
    n = Math.floor(n / 26);
  }
  return suffix;
}

/**
 * `folder` + 3-letter alphabetic position suffix. The lead document in a
 * folder is `<folder>AAA`; the second is `<folder>AAB`; and so on.
 */
export function buildDocumentId(folderId: string, position: number): string {
  return `${folderId}${positionToAlphabeticSuffix(position)}`;
}

/**
 * Lowest 0-based position whose corresponding document id is free in
 * `existingIds`. Used both at upload-time (one position per source file) and
 * later when renaming a folder forces every doc to a new position.
 */
export function findNextAvailablePosition(
  folderId: string,
  existingIds: Set<string>,
  startFrom = 0,
): number {
  let position = Math.max(0, startFrom);
  while (existingIds.has(buildDocumentId(folderId, position))) {
    position += 1;
  }
  return position;
}

export function assignDocumentId(input: AssignDocumentIdInput): AssignedDocumentId {
  const folderId = input.folderId
    ? normalizeFolderId(input.folderId)
    : defaultFolderIdFromFileName(input.sourceName ?? "UNASSIGNED");
  const provided = input.providedDocumentId?.trim();

  // Preserve a directly supplied id verbatim when it is free. We don't try
  // to coerce it into the new naming scheme so existing TAEP-styled imports
  // round-trip unchanged.
  if (provided && !input.existingIds.has(provided)) {
    return {
      documentId: provided,
      generated: false,
      reason: "Preserved supplied document identifier.",
    };
  }

  // Fallback to ids embedded directly in the filename (e.g. `E2002AAA.pdf`)
  // when the caller hasn't passed `providedDocumentId` and the name encodes
  // a complete TAEP id.
  if (!provided && input.sourceName) {
    const extracted = extractDocumentIdFromName(input.sourceName);
    if (extracted && !input.existingIds.has(extracted)) {
      return {
        documentId: extracted,
        generated: false,
        reason: "Preserved document identifier embedded in filename.",
      };
    }
  }

  const position = findNextAvailablePosition(
    folderId,
    input.existingIds,
    input.startPosition ?? 0,
  );

  return {
    documentId: buildDocumentId(folderId, position),
    generated: true,
    reason: provided
      ? "Supplied document identifier already exists; generated a collision-free identifier."
      : "Generated a TAEP-style document identifier from the folder.",
  };
}

/**
 * TAEP attachment suffix for sub-documents detected inside a single source
 * PDF. Position 0 is the base document; positions 1+ get numeric suffixes
 * (`E2002AAF`, `E2002AAF1`, `E2002AAF2`, ...). Numeric — not alphabetic —
 * because letters here mean folder positions, while attachments inside a
 * single file share the same letter and bump a number instead.
 */
export function appendSubDocumentSuffix(baseId: string, position: number): string {
  if (!Number.isInteger(position) || position < 0) {
    throw new Error(`appendSubDocumentSuffix: invalid position ${position}`);
  }
  if (position === 0) return baseId;
  return `${baseId}${position}`;
}

/**
 * `<folder>_Page_<NN>.jpg`, mirroring the TAEP image-list convention shown
 * in the example spreadsheets. `pageNumber` is 1-based; padding is at least
 * two digits and expands automatically for files with 100+ pages.
 */
export function buildImageFilename(folderId: string, pageNumber: number): string {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    throw new Error(`buildImageFilename: invalid pageNumber ${pageNumber}`);
  }
  const padded = String(pageNumber).padStart(2, "0");
  return `${folderId}_Page_${padded}.jpg`;
}
