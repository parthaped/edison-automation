import { PDFDocument } from "pdf-lib";
import { validateSourceFile } from "./file-validation";
import { assignDocumentId, buildImageFilename, normalizeFolderId } from "./id-policy";
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
    } catch {
      return {
        kind: validation.kind,
        pageCount: 0,
        warnings: validation.warnings,
        blockedReason: "PDF could not be opened. It may be corrupt or password protected.",
      };
    }
  }

  return {
    kind: validation.kind,
    pageCount: validation.kind === "csv" || validation.kind === "docx" ? 0 : 1,
    warnings: validation.warnings,
  };
}

export function buildPageManifest(
  documentId: string,
  sourceName: string,
  pageCount: number,
): PageImage[] {
  return Array.from({ length: pageCount }, (_, index) => ({
    id: `${documentId}-page-${index + 1}`,
    documentId,
    pageIndex: index,
    imageFilename: buildImageFilename(documentId, sourceName, index),
    sourcePage: index + 1,
  }));
}

export async function createDocumentPackage(
  input: CreatePackageInput,
): Promise<DocumentPackage> {
  const folderId = input.folderId ? normalizeFolderId(input.folderId) : "UNASSIGNED-F";
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
    pages: buildPageManifest(assigned.documentId, input.sourceFile.name, plan.pageCount),
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
