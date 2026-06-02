import { PDFDocument } from "pdf-lib";
import { validateSourceFile } from "./file-validation";
import {
  assignDocumentId,
  buildImageFilename,
  defaultFolderIdFromFileName,
  normalizeFolderId,
} from "./id-policy";
import type { DocumentPackage, PageImage, SourceFile, SupportedFileKind } from "./types";

export interface CreatePackageInput {
  sourceFile: SourceFile;
  bytes: Uint8Array;
  folderId?: string;
  providedDocumentId?: string;
  batchIndex: number;
  existingIds: Set<string>;
}

export interface ExtractionPlan {
  kind: SupportedFileKind;
  pageCount: number;
  warnings: string[];
  blockedReason?: string;
}

export async function createExtractionPlan(
  sourceFile: SourceFile,
  bytes: Uint8Array,
): Promise<ExtractionPlan> {
  const validation = validateSourceFile({
    name: sourceFile.name,
    size: sourceFile.size,
    mimeType: sourceFile.mimeType,
    bytes,
  });

  if (!validation.accepted || !validation.kind) {
    return {
      kind: "pdf",
      pageCount: 0,
      warnings: validation.warnings,
      blockedReason: validation.reason ?? "Unsupported file type.",
    };
  }

  if (validation.kind === "pdf") {
    try {
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
      return {
        kind: validation.kind,
        pageCount: pdf.getPageCount(),
        warnings: validation.warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      const encrypted =
        message.includes("encrypt") || message.includes("password");
      return {
        kind: validation.kind,
        pageCount: 0,
        warnings: validation.warnings,
        blockedReason: encrypted
          ? "PDF is password protected."
          : "PDF could not be opened. It may be corrupt.",
      };
    }
  }

  return {
    kind: validation.kind,
    pageCount: 1,
    warnings: validation.warnings,
  };
}

export function buildPageManifest(
  documentId: string,
  folderId: string,
  pageCount: number,
): PageImage[] {
  return Array.from({ length: pageCount }, (_, index) => ({
    id: `${documentId}-page-${index + 1}`,
    documentId,
    pageIndex: index,
    imageFilename: buildImageFilename(folderId, index + 1),
    sourcePage: index + 1,
  }));
}

// Builds the page manifest for a sub-document that owns a contiguous slice of
// the source PDF (pages startPage..endPage, both 1-based inclusive). The
// returned pages are re-indexed from 0 so the viewer's "page X of N" matches
// the sub-document, but `sourcePage` preserves the original PDF page number
// so reviewers can cross-reference back to the source. `folderId` drives the
// `<folder>_Page_NN.jpg` naming so siblings of the same PDF share filenames.
export function buildPageManifestForRange(
  documentId: string,
  folderId: string,
  startPage: number,
  endPage: number,
): PageImage[] {
  if (startPage < 1 || endPage < startPage) {
    throw new Error(
      `buildPageManifestForRange: invalid range ${startPage}..${endPage}`,
    );
  }
  const length = endPage - startPage + 1;
  return Array.from({ length }, (_, index) => ({
    id: `${documentId}-page-${index + 1}`,
    documentId,
    pageIndex: index,
    // The image filename refers to the *source* page (so sibling
    // sub-documents that share an underlying scan reuse the same JPGs).
    imageFilename: buildImageFilename(folderId, startPage + index),
    sourcePage: startPage + index,
  }));
}

export async function createDocumentPackage(
  input: CreatePackageInput,
): Promise<DocumentPackage> {
  const folderId = input.folderId
    ? normalizeFolderId(input.folderId)
    : defaultFolderIdFromFileName(input.sourceFile.name);
  const assigned = assignDocumentId({
    folderId,
    providedDocumentId: input.providedDocumentId,
    sourceName: input.sourceFile.name,
    batchIndex: input.batchIndex,
    existingIds: input.existingIds,
  });
  const plan = await createExtractionPlan(input.sourceFile, input.bytes);
  const now = new Date().toISOString();

  return {
    id: assigned.documentId,
    folderId,
    documentId: assigned.documentId,
    title: `[${assigned.documentId}], ${input.sourceFile.name}`,
    sourceFile: input.sourceFile,
    pages: buildPageManifest(assigned.documentId, folderId, plan.pageCount),
    status: plan.blockedReason ? "blocked" : "queued",
    confidence: plan.blockedReason ? "blocked" : "medium",
    validationWarnings: [
      ...plan.warnings,
      assigned.reason,
      ...(plan.blockedReason ? [plan.blockedReason] : []),
    ],
    uncertaintyNotes: [],
    createdAt: now,
    updatedAt: now,
  };
}
