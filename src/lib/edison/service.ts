import { AppError } from "./app-error";
import {
  InMemoryAuditLog,
  type AuditEvent,
  type AuditEventType,
  type AuditLog,
} from "./audit-log";
import { extractUncertainReadings, gradeTranscription } from "./confidence";
import {
  buildPageManifestForRange,
  createDocumentPackage,
  createExtractionPlan,
  type ExtractionPlan,
} from "./extraction";
import { buildExportCsv, buildExportCsvRow } from "./export-csv";
import { buildTaepIndexCsv, buildTaepIndexRow } from "./export-taep-index";
import {
  appendSubDocumentSuffix,
  assignDocumentId,
  buildDocumentId,
  defaultFolderIdFromFileName,
  findNextAvailablePosition,
  normalizeFolderId,
} from "./id-policy";
import {
  buildMetadataExtraction,
  normalizeMetadata,
} from "./metadata-normalize";
import { getActivePrompt } from "./prompts";
import type { TranscribedMetadata } from "./transcribe";
import type {
  DashboardSummary,
  EdisonRepository,
  ReviewCase,
} from "./repositories";
import {
  buildReviewCase,
  emptyMetadata,
  emptyTranscription,
  summarizeDocuments,
} from "./repositories";
import type {
  ConfidenceBucket,
  DocumentPackage,
  MetadataExtraction,
  SourceFile,
  SourceGroup,
  TranscriptionRun,
} from "./types";

export interface TranscriptionError {
  fileName: string;
  stage: "transcription" | "metadata";
  message: string;
}

export interface ManualIngestResult {
  packages: DocumentPackage[];
  transcriptions: TranscriptionRun[];
  metadata: MetadataExtraction[];
  transcriptionErrors: TranscriptionError[];
}

export interface BatchExportRow {
  document: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
}

export interface BatchExportPayload {
  packages: DocumentPackage[];
  transcriptions: TranscriptionRun[];
  metadata: MetadataExtraction[];
}

export interface ProcessSourceFileInput {
  sourceFile: SourceFile;
  bytes: Uint8Array;
  folderId?: string;
  batchIndex: number;
  existingIds: Set<string>;
  // Pre-assigned, collision-free document identifier. When supplied (e.g. by the
  // ingest workflow's assignment pre-pass), it is preserved as-is instead of
  // re-deriving an ID from the filename, which avoids races between concurrent
  // files that resolve to the same embedded identifier.
  providedDocumentId?: string;
  rawOcrText?: string;
  model?: string;
  // Per-page durable URLs to render in the viewer. Single-image uploads supply
  // exactly one entry for `pageIndex: 0`; multi-page PDFs are rasterized to
  // JPGs upstream and supply one entry per page. Pages without an entry fall
  // back to a neutral "source image unavailable" placeholder.
  pageImageUrls?: PageImageUrl[];
  // When PDF rasterization failed upstream, this message is folded into
  // `validationWarnings` and stamped onto every page's `renderError` so the
  // viewer can show *why* the source image is missing.
  rasterizeError?: string;
}

export interface PageImageUrl {
  pageIndex: number;
  url: string;
  width?: number;
  height?: number;
}

export interface ProcessSourceFileResult {
  documentPackage: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
  confidence: ConfidenceBucket;
  confidenceReasons: string[];
}

// Re-exported so existing call sites and tests can keep importing the grader
// from the service module; the implementation lives in ./confidence.
export { scoreConfidence } from "./confidence";

export function resolvePersistedDocumentStatus(
  documentPackage: DocumentPackage,
): DocumentPackage {
  if (documentPackage.status === "queued" && documentPackage.pages.length > 0) {
    return { ...documentPackage, status: "needs_review" };
  }
  return documentPackage;
}

export function mergeTranscribedMetadata(
  processed: MetadataExtraction,
  transcribed?: TranscribedMetadata,
): MetadataExtraction {
  if (!transcribed) {
    return normalizeMetadata(processed);
  }
  return normalizeMetadata({
    ...processed,
    title: transcribed.title?.trim() || processed.title,
    documentType: transcribed.documentType || processed.documentType,
    date: transcribed.date || processed.date,
    authors: transcribed.authors,
    recipients: transcribed.recipients,
    mentionedNames: transcribed.mentionedNames,
    subjects:
      transcribed.subjects.length > 0
        ? transcribed.subjects
        : processed.subjects,
    places: transcribed.places ?? processed.places,
    comments: transcribed.comments ?? processed.comments,
  });
}

export async function processSourceFile(
  input: ProcessSourceFileInput,
): Promise<ProcessSourceFileResult> {
  const built = await createDocumentPackage({
    sourceFile: input.sourceFile,
    bytes: input.bytes,
    folderId: input.folderId,
    providedDocumentId: input.providedDocumentId,
    batchIndex: input.batchIndex,
    existingIds: input.existingIds,
  });

  // Attach the per-page rendered image URLs supplied by the rasterize step.
  // PDFs come back with one URL per page; image uploads come back with a
  // single entry for page 0. Pages without a URL keep the neutral
  // "source image unavailable" placeholder and a disabled download button.
  const urlByPageIndex = new Map<number, PageImageUrl>();
  for (const entry of input.pageImageUrls ?? []) {
    urlByPageIndex.set(entry.pageIndex, entry);
  }

  const builtWithPageRenderState: DocumentPackage =
    built.pages.length > 0
      ? {
          ...built,
          pages: built.pages.map((page) => {
            const match = urlByPageIndex.get(page.pageIndex);
            if (match) {
              return {
                ...page,
                originalUrl: match.url,
                ...(match.width !== undefined ? { width: match.width } : {}),
                ...(match.height !== undefined ? { height: match.height } : {}),
              };
            }
            // No rendered URL for this page. Surface the rasterize error (if
            // we have one) so the viewer's placeholder explains *why*.
            return input.rasterizeError
              ? { ...page, renderError: input.rasterizeError }
              : page;
          }),
        }
      : built;

  const packageWithUrls: DocumentPackage = input.rasterizeError
    ? {
        ...builtWithPageRenderState,
        validationWarnings: [
          ...builtWithPageRenderState.validationWarnings,
          input.rasterizeError,
        ],
      }
    : builtWithPageRenderState;

  const blocked = packageWithUrls.status === "blocked";
  const rawOcrText = input.rawOcrText ?? "";
  const cleanedText = rawOcrText.trim();
  const uncertainReadings = blocked ? [] : extractUncertainReadings(cleanedText);
  const confidenceResult = gradeTranscription({
    pageCount: packageWithUrls.pages.length,
    blocked,
    text: cleanedText,
    uncertainReadings: uncertainReadings.length,
  });

  const documentPackage: DocumentPackage = {
    ...packageWithUrls,
    confidence: confidenceResult.bucket,
  };

  const diplomaticPrompt = getActivePrompt("diplomatic-transcription");
  const transcription: TranscriptionRun = {
    id: `${documentPackage.documentId}-run-1`,
    documentId: documentPackage.documentId,
    model: input.model ?? "gemini-configured-model",
    promptVersion: diplomaticPrompt.version,
    ocrText: rawOcrText,
    diplomaticText: cleanedText,
    uncertainReadings,
  };

  const metadata = buildMetadataExtraction({
    folderId: documentPackage.folderId,
    documentId: documentPackage.documentId,
    fallbackTitle: documentPackage.title,
    imageNames: documentPackage.pages.map((page) => page.imageFilename),
    confidence: confidenceResult.bucket,
  });

  return {
    documentPackage,
    transcription,
    metadata,
    confidence: confidenceResult.bucket,
    confidenceReasons: confidenceResult.reasons,
  };
}

// Validates that a user-supplied splits payload covers every page in the
// source PDF exactly once: the splits must be sorted, contiguous, and cover
// 1..totalPages. Throws AppError("BAD_REQUEST") on any violation; returns
// silently on success.
export function validateContiguousSplits(
  splits: Array<{ startPage: number; endPage: number }>,
  totalPages: number,
): void {
  if (!Array.isArray(splits) || splits.length === 0) {
    throw new AppError("BAD_REQUEST", "Provide at least one split.", 400);
  }
  let cursor = 0;
  for (const [index, split] of splits.entries()) {
    if (!Number.isInteger(split.startPage) || !Number.isInteger(split.endPage)) {
      throw new AppError(
        "BAD_REQUEST",
        `Split ${index + 1} must have integer page numbers.`,
        400,
      );
    }
    if (split.startPage !== cursor + 1) {
      throw new AppError(
        "BAD_REQUEST",
        `Split ${index + 1} must start at page ${cursor + 1} but starts at ${split.startPage}.`,
        400,
      );
    }
    if (split.endPage < split.startPage) {
      throw new AppError(
        "BAD_REQUEST",
        `Split ${index + 1} ends (${split.endPage}) before it starts (${split.startPage}).`,
        400,
      );
    }
    if (split.endPage > totalPages) {
      throw new AppError(
        "BAD_REQUEST",
        `Split ${index + 1} ends at page ${split.endPage}, beyond the source's ${totalPages} pages.`,
        400,
      );
    }
    cursor = split.endPage;
  }
  if (cursor !== totalPages) {
    throw new AppError(
      "BAD_REQUEST",
      `Splits must cover every page; last split ends at ${cursor} but source has ${totalPages} pages.`,
      400,
    );
  }
}

// ---------- multi-sub-document processing ----------
//
// Used by the ingest workflow once the OCR model returns per-document
// boundaries inside a single uploaded source. Single-document uploads pass
// in one entry covering every page and get back exactly one sibling, so the
// flow is uniform regardless of whether splits were detected.

export interface TranscribedSubDocument {
  startPage: number;
  endPage: number;
  ocrText: string;
  uncertainReadings: string[];
  metadata: TranscribedMetadata;
}

export interface ProcessSourceSubDocumentsInput {
  sourceFile: SourceFile;
  bytes: Uint8Array;
  /** When supplied, skips re-opening the source bytes for page count / validation. */
  extractionPlan?: ExtractionPlan;
  folderId?: string;
  // Pre-assigned, collision-free base document identifier for this source
  // file. Position-0 sibling keeps this id; siblings 1..N get suffixed via
  // `appendSubDocumentSuffix`. When omitted, an id is derived from the
  // filename + `existingIds`.
  providedDocumentId?: string;
  batchIndex: number;
  existingIds: Set<string>;
  // Sub-documents detected by the model. Length 1 for single-document
  // uploads. Page numbers are 1-based and refer to the source PDF.
  subDocuments: TranscribedSubDocument[];
  model?: string;
  pageImageUrls?: PageImageUrl[];
  rasterizeError?: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ProcessedSubDocument {
  documentPackage: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
  confidence: ConfidenceBucket;
}

export interface ProcessSourceSubDocumentsResult {
  // True when the source itself was rejected (encrypted PDF, unsupported
  // type, etc.). When true, `siblings` holds a single blocked DocumentPackage
  // with no sub-document split and no sourceGroup.
  blocked: boolean;
  siblings: ProcessedSubDocument[];
}

// Builds N reviewable DocumentPackages from one validated source. Each
// sibling owns a contiguous page slice, links to its peers via `sourceGroup`,
// and carries its own transcription + metadata extraction.
export async function processSourceFileSubDocuments(
  input: ProcessSourceSubDocumentsInput,
): Promise<ProcessSourceSubDocumentsResult> {
  const plan =
    input.extractionPlan ??
    (await createExtractionPlan(input.sourceFile, input.bytes));
  const folderId = input.folderId
    ? normalizeFolderId(input.folderId)
    : defaultFolderIdFromFileName(input.sourceFile.name);
  const baseAssignment = assignDocumentId({
    folderId,
    providedDocumentId: input.providedDocumentId,
    sourceName: input.sourceFile.name,
    batchIndex: input.batchIndex,
    existingIds: input.existingIds,
  });

  // Reject path: validation failed before we even reached the model. Persist
  // a single blocked record so the reviewer sees the file but it's never
  // approvable, and never carries a sourceGroup (no splits to manage).
  if (plan.blockedReason) {
    const now = new Date().toISOString();
    const blockedPackage: DocumentPackage = {
      id: baseAssignment.documentId,
      folderId,
      documentId: baseAssignment.documentId,
      title: `[${baseAssignment.documentId}], ${input.sourceFile.name}`,
      sourceFile: input.sourceFile,
      pages: [],
      status: "blocked",
      confidence: "blocked",
      validationWarnings: [
        ...plan.warnings,
        baseAssignment.reason,
        plan.blockedReason,
      ],
      uncertaintyNotes: [],
      createdAt: now,
      updatedAt: now,
    };
    const transcription = emptyTranscription(baseAssignment.documentId);
    const metadata = emptyMetadata(blockedPackage);
    return {
      blocked: true,
      siblings: [
        {
          documentPackage: blockedPackage,
          transcription,
          metadata,
          confidence: "blocked",
        },
      ],
    };
  }

  const totalPages = Math.max(1, plan.pageCount);
  const normalized = normalizeSubDocuments(input.subDocuments, totalPages);
  const urlByPage = new Map<number, PageImageUrl>();
  for (const entry of input.pageImageUrls ?? []) {
    // pageImageUrls use 0-based pageIndex referring to the source PDF.
    urlByPage.set(entry.pageIndex + 1, entry);
  }

  const diplomaticPrompt = getActivePrompt("diplomatic-transcription");
  const groupId = baseAssignment.documentId;
  const siblingIds = normalized.map((_sub, position) =>
    appendSubDocumentSuffix(groupId, position),
  );

  const sourceGroupBase: Omit<SourceGroup, "position"> = {
    groupId,
    originalFileName: input.sourceFile.name,
    siblingIds,
    totalPages,
  };

  const siblings: ProcessedSubDocument[] = normalized.map((sub, position) => {
    const documentId = siblingIds[position];
    const pages = buildPageManifestForRange(
      documentId,
      folderId,
      sub.startPage,
      sub.endPage,
    ).map((page) => {
      const urlEntry = urlByPage.get(page.sourcePage);
      if (urlEntry) {
        return {
          ...page,
          originalUrl: urlEntry.url,
          ...(urlEntry.width !== undefined ? { width: urlEntry.width } : {}),
          ...(urlEntry.height !== undefined ? { height: urlEntry.height } : {}),
        };
      }
      return input.rasterizeError
        ? { ...page, renderError: input.rasterizeError }
        : page;
    });

    const cleanedText = sub.ocrText.trim();
    const uncertainReadings =
      sub.uncertainReadings.length > 0
        ? sub.uncertainReadings
        : extractUncertainReadings(cleanedText);
    const confidenceResult = gradeTranscription({
      pageCount: pages.length,
      blocked: false,
      text: cleanedText,
      uncertainReadings: uncertainReadings.length,
    });

    const now = new Date().toISOString();
    const titleSuffix =
      normalized.length > 1
        ? ` (pages ${sub.startPage}\u2013${sub.endPage})`
        : "";
    const displayTitle = sub.metadata.title?.trim() || input.sourceFile.name;

    const validationWarnings: string[] = [
      ...plan.warnings,
      ...(position === 0 ? [baseAssignment.reason] : []),
    ];
    if (input.rasterizeError) {
      validationWarnings.push(input.rasterizeError);
    }

    const documentPackage: DocumentPackage = {
      id: documentId,
      folderId,
      documentId,
      title: `[${documentId}], ${displayTitle}${titleSuffix}`,
      sourceFile: input.sourceFile,
      pages,
      status: "queued",
      confidence: confidenceResult.bucket,
      validationWarnings,
      uncertaintyNotes: [],
      createdAt: now,
      updatedAt: now,
      sourceGroup: {
        ...sourceGroupBase,
        position,
      },
    };

    const transcription: TranscriptionRun = {
      id: `${documentId}-run-1`,
      documentId,
      model: input.model ?? "gemini-configured-model",
      promptVersion: diplomaticPrompt.version,
      ocrText: sub.ocrText,
      diplomaticText: cleanedText,
      uncertainReadings,
      // Token counts are emitted per-source by the transcription backend. Attribute them
      // to the first sibling so totals add up correctly without double-counting.
      ...(position === 0 && input.inputTokens !== undefined
        ? { inputTokens: input.inputTokens }
        : {}),
      ...(position === 0 && input.outputTokens !== undefined
        ? { outputTokens: input.outputTokens }
        : {}),
    };

    const metadata = buildMetadataExtraction({
      folderId,
      documentId,
      transcribed: sub.metadata,
      fallbackTitle: sub.metadata.title?.trim() || documentPackage.title,
      imageNames: pages.map((page) => page.imageFilename),
      confidence: confidenceResult.bucket,
    });

    return {
      documentPackage: resolvePersistedDocumentStatus(documentPackage),
      transcription,
      metadata,
      confidence: confidenceResult.bucket,
    };
  });

  return { blocked: false, siblings };
}

// Sorts, clamps, and merges sub-document entries so downstream code can trust
// the ranges. Behavior:
//   - drops entries fully outside [1, totalPages]
//   - clamps overlapping ranges so siblings stay disjoint (earlier sibling
//     wins on overlap)
//   - if the model returned nothing usable, falls back to one entry covering
//     the entire source so we always emit at least one sibling
export function normalizeSubDocuments(
  subDocuments: TranscribedSubDocument[],
  totalPages: number,
): TranscribedSubDocument[] {
  const sorted = [...subDocuments]
    .map((entry) => ({
      ...entry,
      startPage: Math.max(1, Math.min(entry.startPage, totalPages)),
      endPage: Math.max(1, Math.min(entry.endPage, totalPages)),
    }))
    .filter((entry) => entry.endPage >= entry.startPage)
    .sort((a, b) => a.startPage - b.startPage);

  const cleaned: TranscribedSubDocument[] = [];
  let cursor = 0;
  for (const entry of sorted) {
    const start = Math.max(entry.startPage, cursor + 1);
    if (start > entry.endPage) {
      // Fully overlapped by an earlier sibling; drop it.
      continue;
    }
    cleaned.push({ ...entry, startPage: start, endPage: entry.endPage });
    cursor = entry.endPage;
  }

  if (cleaned.length === 0) {
    return [
      {
        startPage: 1,
        endPage: totalPages,
        ocrText: "",
        uncertainReadings: [],
        metadata: {
          title: "",
          documentType: "",
          date: "",
          authors: [],
          recipients: [],
          mentionedNames: [],
          subjects: [],
          places: [],
        },
      },
    ];
  }

  return cleaned;
}

export class EdisonAutomationService {
  private readonly auditLog: AuditLog;

  constructor(
    private readonly repository: EdisonRepository,
    auditLog: AuditLog = new InMemoryAuditLog(),
  ) {
    this.auditLog = auditLog;
  }

  getRepository(): EdisonRepository {
    return this.repository;
  }

  getAuditLog(): AuditLog {
    return this.auditLog;
  }

  private async emit(event: Omit<AuditEvent, "id" | "timestamp"> & {
    timestamp?: string;
  }): Promise<void> {
    try {
      await this.auditLog.append({
        ...event,
        timestamp: event.timestamp ?? new Date().toISOString(),
      });
    } catch (error) {
      // Audit is best-effort; never let a logging failure roll back the
      // surrounding mutation. Surface to the server log instead.
      console.error("Failed to append audit event", event.type, error);
    }
  }

  async getDashboard(): Promise<{ summary: DashboardSummary }> {
    const documents = await this.repository.listDocuments();
    return { summary: summarizeDocuments(documents) };
  }

  // Loads review workbench data. Summary counts scan every record; the review
  // queue loads one paginated window so large datasets do not fetch every JSON
  // body on each page view.
  async getReviewWorkbench(
    documentId?: string,
    pagination?: { offset?: number; limit?: number },
  ): Promise<{
    summary: DashboardSummary;
    reviewCase: ReviewCase | null;
    totalDocuments: number;
    reviewOffset: number;
    reviewLimit: number;
    hasMoreReviewDocuments: boolean;
  }> {
    const reviewLimit = pagination?.limit ?? 50;
    const reviewOffset = pagination?.offset ?? 0;
    const [summaryRecords, page] = await Promise.all([
      this.repository.listDocumentRecords(),
      this.repository.listDocumentRecordsPage({
        offset: reviewOffset,
        limit: reviewLimit,
      }),
    ]);
    return {
      summary: summarizeDocuments(summaryRecords.documents),
      reviewCase: buildReviewCase(page, documentId),
      totalDocuments: page.totalCount,
      reviewOffset: page.offset,
      reviewLimit: page.limit,
      hasMoreReviewDocuments: page.hasMore,
    };
  }

  async getReviewCase(documentId?: string) {
    return this.repository.getReviewCase(documentId);
  }

  async getDocumentRecord(documentId: string) {
    return this.repository.getDocumentRecord(documentId);
  }

  async getAuditTrail(opts?: {
    limit?: number;
    types?: AuditEventType[];
    documentId?: string;
    scope?: "all" | "active" | "past";
  }): Promise<AuditEvent[]> {
    const events = await this.auditLog.list({
      limit: opts?.limit,
      types: opts?.types,
      documentId: opts?.documentId,
    });
    if (!opts?.scope || opts.scope === "all") return events;

    // For the active/past scope filter we need to know each event's
    // *current* document status, not the status at the time of the event.
    const records = await this.repository.listDocumentRecords();
    const statusById = new Map<string, string>();
    for (const document of records.documents) {
      statusById.set(document.documentId, document.status);
    }
    return events.filter((event) => {
      if (!event.documentId) return opts.scope === "all";
      const status = statusById.get(event.documentId);
      const isPast = status === "approved" || status === "exported";
      return opts.scope === "past" ? isPast : !isPast;
    });
  }

  async getApprovedDocuments(pagination?: {
    offset?: number;
    limit?: number;
  }) {
    const limit = pagination?.limit ?? 50;
    const offset = pagination?.offset ?? 0;
    return this.repository.listApprovedDocumentsPage({ offset, limit });
  }

  async getGroupSiblings(groupId: string) {
    const siblings = await this.repository.listGroupSiblings(groupId);
    if (siblings.length === 0) {
      throw new AppError("NOT_FOUND", "Document group was not found.", 404);
    }
    return siblings;
  }

  // Rewrites the entire set of siblings for a group from user-provided splits.
  // Each split's page range is validated against the source PDF's total page
  // count; ranges that match an existing sibling keep that sibling's
  // transcription and metadata, while changed ranges produce a fresh sibling
  // marked `needs_review` so the operator knows the AI output is stale.
  async updateGroupSplits(
    groupId: string,
    splits: Array<{ startPage: number; endPage: number; title?: string }>,
  ) {
    const siblings = await this.getGroupSiblings(groupId);
    const totalPages = siblings[0].document.sourceGroup?.totalPages ?? 0;
    if (totalPages < 1) {
      throw new AppError(
        "BAD_REQUEST",
        "This group has no recorded total page count and cannot be split.",
        409,
      );
    }
    validateContiguousSplits(splits, totalPages);

    // Pre-compute a sourcePage → image url map by scanning every existing
    // sibling's pages. Rasterization happens once per source upload, so
    // reusing the URLs avoids re-rendering when only page ranges change.
    const urlBySourcePage = new Map<
      number,
      { url: string; width?: number; height?: number; renderError?: string }
    >();
    for (const sibling of siblings) {
      for (const page of sibling.document.pages) {
        if (page.originalUrl && !urlBySourcePage.has(page.sourcePage)) {
          urlBySourcePage.set(page.sourcePage, {
            url: page.originalUrl,
            width: page.width,
            height: page.height,
          });
        } else if (page.renderError && !urlBySourcePage.has(page.sourcePage)) {
          urlBySourcePage.set(page.sourcePage, { url: "", renderError: page.renderError });
        }
      }
    }

    // Index existing siblings by their (startPage, endPage) so unchanged splits
    // can reuse their stored transcription text verbatim instead of being
    // discarded and rebuilt empty.
    const existingByRange = new Map<string, (typeof siblings)[number]>();
    for (const sibling of siblings) {
      const pages = sibling.document.pages;
      if (pages.length === 0) continue;
      const start = pages[0].sourcePage;
      const end = pages[pages.length - 1].sourcePage;
      existingByRange.set(`${start}-${end}`, sibling);
    }

    const sourceFile = siblings[0].document.sourceFile;
    const folderId = siblings[0].document.folderId;
    const newSiblingIds = splits.map((_, position) =>
      appendSubDocumentSuffix(groupId, position),
    );

    const nextRecords = splits.map((split, position) => {
      const documentId = newSiblingIds[position];
      const rangeKey = `${split.startPage}-${split.endPage}`;
      const reuse = existingByRange.get(rangeKey);

      const pages = buildPageManifestForRange(
        documentId,
        folderId,
        split.startPage,
        split.endPage,
      ).map((page) => {
        const urlEntry = urlBySourcePage.get(page.sourcePage);
        if (urlEntry?.url) {
          return {
            ...page,
            originalUrl: urlEntry.url,
            ...(urlEntry.width !== undefined ? { width: urlEntry.width } : {}),
            ...(urlEntry.height !== undefined ? { height: urlEntry.height } : {}),
          };
        }
        return urlEntry?.renderError
          ? { ...page, renderError: urlEntry.renderError }
          : page;
      });

      const now = new Date().toISOString();
      const splitsChanged = !reuse;
      const titleSeed =
        split.title?.trim() ||
        reuse?.metadata.title?.trim() ||
        sourceFile.name;
      const documentPackage: DocumentPackage = {
        id: documentId,
        folderId,
        documentId,
        title: `[${documentId}], ${titleSeed} (pages ${split.startPage}\u2013${split.endPage})`,
        sourceFile,
        pages,
        status: splitsChanged ? "needs_review" : reuse.document.status,
        confidence: reuse?.document.confidence ?? "medium",
        validationWarnings: splitsChanged
          ? ["Split edited \u2014 re-run transcription to refresh text."]
          : reuse.document.validationWarnings,
        uncertaintyNotes: reuse?.document.uncertaintyNotes ?? [],
        createdAt: reuse?.document.createdAt ?? now,
        updatedAt: now,
        sourceGroup: {
          groupId,
          originalFileName: sourceFile.name,
          position,
          siblingIds: newSiblingIds,
          totalPages,
        },
      };

      const transcription: TranscriptionRun = reuse
        ? {
            ...reuse.transcription,
            documentId,
            id: `${documentId}-run-1`,
          }
        : emptyTranscription(documentId);

      const metadata: MetadataExtraction = reuse
        ? {
            ...reuse.metadata,
            documentId,
            folderId,
            title: titleSeed,
            imageNames: pages.map((page) => page.imageFilename),
          }
        : {
            ...emptyMetadata(documentPackage),
            title: titleSeed,
          };

      return { document: documentPackage, transcription, metadata };
    });

    await this.repository.replaceGroupSiblings(groupId, nextRecords);

    const previousById = new Map(
      siblings.map((sibling) => [sibling.document.documentId, sibling]),
    );
    for (const next of nextRecords) {
      const previous = previousById.get(next.document.documentId);
      const oldRange = previous
        ? rangeLabel(previous.document)
        : "(new sibling)";
      const newRange = rangeLabel(next.document);
      await this.emit({
        type: "splits_changed",
        documentId: next.document.documentId,
        folderId: next.document.folderId,
        title: next.document.title,
        detail: `Pages ${oldRange} → ${newRange}`,
        metadata: {
          groupId,
          previousRange: oldRange,
          newRange,
          totalSiblings: nextRecords.length,
        },
      });
    }

    return nextRecords;
  }

  async saveTranscriptionEdit(documentId: string, diplomaticText: string) {
    const record = await this.repository.getDocumentRecord(documentId);
    if (!record) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    const previousLength = record.transcription.diplomaticText.length;
    const updated = await this.repository.updateTranscriptionText(
      documentId,
      diplomaticText,
    );
    if (!updated) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    await this.emit({
      type: "text_edited",
      documentId,
      folderId: updated.folderId,
      title: updated.title,
      detail: `${diplomaticText.length} characters (${signedDelta(diplomaticText.length - previousLength)})`,
      metadata: {
        previousLength,
        newLength: diplomaticText.length,
        delta: diplomaticText.length - previousLength,
      },
    });
    return updated;
  }

  async saveMetadataComments(documentId: string, comments: string) {
    const record = await this.repository.getDocumentRecord(documentId);
    if (!record) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    const previousComments = record.metadata.comments ?? "";
    const metadata = normalizeMetadata({
      ...record.metadata,
      comments: comments.trim() || undefined,
    });
    await this.repository.saveProcessedDocument(
      record.document,
      record.transcription,
      metadata,
    );
    await this.emit({
      type: "comments_edited",
      documentId,
      folderId: record.document.folderId,
      title: record.document.title,
      detail:
        comments.trim().length > 0
          ? `${comments.trim().length} characters`
          : "Comments cleared",
      metadata: {
        previousComments,
        newComments: metadata.comments ?? "",
      },
    });
    return metadata;
  }

  async approveDocument(documentId: string) {
    const record = await this.repository.getDocumentRecord(documentId);
    if (!record) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    if (record.document.status === "blocked") {
      throw new AppError(
        "BAD_REQUEST",
        "Blocked documents cannot be approved for export.",
        409,
      );
    }

    const updated = await this.repository.approveDocument(documentId);
    if (!updated) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    await this.emit({
      type: "approved",
      documentId,
      folderId: updated.folderId,
      title: updated.title,
      confidence: updated.confidence,
      status: updated.status,
      detail: `Approved for export (was ${record.document.status})`,
      metadata: { previousStatus: record.document.status },
    });
    return updated;
  }

  async unapproveDocument(documentId: string) {
    const record = await this.repository.getDocumentRecord(documentId);
    if (!record) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    if (record.document.status !== "approved") {
      throw new AppError(
        "BAD_REQUEST",
        "Only approved documents can be sent back to review.",
        409,
      );
    }
    const updated = await this.repository.unapproveDocument(documentId);
    if (!updated) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    await this.emit({
      type: "unapproved",
      documentId,
      folderId: updated.folderId,
      title: updated.title,
      confidence: updated.confidence,
      status: updated.status,
      detail: "Sent back to review queue",
      metadata: { previousStatus: "approved" },
    });
    return updated;
  }

  async deleteDocument(documentId: string) {
    const record = await this.repository.getDocumentRecord(documentId);
    const deleted = await this.repository.deleteDocument(documentId);
    if (!deleted) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    await this.emit({
      type: "deleted",
      documentId,
      folderId: record?.document.folderId,
      title: record?.document.title,
      detail: record
        ? `Removed ${record.document.pages.length} page(s) from ${record.document.sourceFile.name}`
        : "Document removed",
      metadata: record
        ? {
            previousStatus: record.document.status,
            sourceFile: record.document.sourceFile.name,
          }
        : undefined,
    });
  }

  /**
   * Renames the folder id for a single document or, when the document belongs
   * to a `sourceGroup`, rebuilds every sibling under the new folder. The new
   * folder id is normalized via `normalizeFolderId`, and resulting doc ids
   * must not collide with documents outside this group.
   */
  async renameFolderId(documentId: string, newFolderId: string) {
    const normalizedFolder = normalizeFolderId(newFolderId);
    if (normalizedFolder.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "Folder ID must contain at least one letter or digit.",
        400,
      );
    }
    const record = await this.repository.getDocumentRecord(documentId);
    if (!record) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    const previousFolder = record.document.folderId;
    if (previousFolder === normalizedFolder) {
      return [record];
    }

    const isGrouped = Boolean(record.document.sourceGroup);
    const siblings = isGrouped
      ? await this.repository.listGroupSiblings(record.document.sourceGroup!.groupId)
      : [record];

    // Build a set of existing IDs excluding the ones we're about to rename so
    // we can detect collisions with unrelated records under the new folder.
    const existingIds = new Set(await this.repository.listDocumentIds());
    for (const sibling of siblings) {
      existingIds.delete(sibling.document.documentId);
    }

    const basePosition = findNextAvailablePosition(
      normalizedFolder,
      existingIds,
    );
    const baseId = buildDocumentId(normalizedFolder, basePosition);
    const newIds = siblings.map((_, index) =>
      appendSubDocumentSuffix(baseId, index),
    );

    // Verify the generated ids are themselves disjoint from existing records.
    for (const candidate of newIds) {
      if (existingIds.has(candidate)) {
        throw new AppError(
          "BAD_REQUEST",
          `Cannot rename: a document already exists with id "${candidate}" under the new folder.`,
          409,
        );
      }
    }

    const now = new Date().toISOString();
    const renamed = siblings.map((sibling, index) => {
      const newId = newIds[index];
      const oldId = sibling.document.documentId;
      const oldTitle = sibling.document.title;
      const updatedTitle = oldTitle.startsWith(`[${oldId}]`)
        ? `[${newId}]${oldTitle.slice(`[${oldId}]`.length)}`
        : oldTitle;
      const updatedPages = sibling.document.pages.map((page, pageIndex) => ({
        ...page,
        id: `${newId}-page-${pageIndex + 1}`,
        documentId: newId,
      }));
      const updatedSourceGroup = sibling.document.sourceGroup
        ? {
            ...sibling.document.sourceGroup,
            groupId: newIds[0],
            siblingIds: newIds,
          }
        : undefined;

      return {
        document: {
          ...sibling.document,
          id: newId,
          documentId: newId,
          folderId: normalizedFolder,
          title: updatedTitle,
          pages: updatedPages,
          updatedAt: now,
          ...(updatedSourceGroup ? { sourceGroup: updatedSourceGroup } : {}),
        },
        transcription: {
          ...sibling.transcription,
          id: `${newId}-run-1`,
          documentId: newId,
        },
        metadata: {
          ...sibling.metadata,
          documentId: newId,
          folderId: normalizedFolder,
        },
      };
    });

    if (isGrouped && record.document.sourceGroup) {
      await this.repository.replaceGroupSiblings(
        record.document.sourceGroup.groupId,
        renamed,
      );
    } else {
      // Standalone document: write the new record, then delete the old one.
      const next = renamed[0];
      await this.repository.saveProcessedDocument(
        next.document,
        next.transcription,
        next.metadata,
      );
      await this.repository.deleteDocument(documentId);
    }

    for (const sibling of renamed) {
      await this.emit({
        type: "folder_renamed",
        documentId: sibling.document.documentId,
        folderId: normalizedFolder,
        title: sibling.document.title,
        detail: `${previousFolder} → ${normalizedFolder}`,
        metadata: {
          previousFolderId: previousFolder,
          newFolderId: normalizedFolder,
          previousDocumentId: siblings[renamed.indexOf(sibling)].document.documentId,
        },
      });
    }

    return renamed;
  }

  async buildBatchExportFromPayload(
    payload: BatchExportPayload,
  ): Promise<{ bytes: Uint8Array; fileName: string; documentCount: number }> {
    if (payload.packages.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "Payload must include at least one document package.",
        400,
      );
    }

    const transcriptionsById = new Map(
      payload.transcriptions.map((entry) => [entry.documentId, entry]),
    );
    const metadataById = new Map(
      payload.metadata.map((entry) => [entry.documentId, entry]),
    );

    const rows: BatchExportRow[] = payload.packages.map((document) => ({
      document,
      transcription:
        transcriptionsById.get(document.documentId) ??
        emptyTranscription(document.documentId),
      metadata:
        metadataById.get(document.documentId) ?? emptyMetadata(document),
    }));

    return buildBatchZip(rows);
  }

  async exportTranscriptionsCsv(): Promise<string> {
    const rows = await this.repository.listApprovedExportRows();
    if (rows.length === 0) {
      throw new AppError(
        "EXPORT_FAILED",
        "No approved records are available for export.",
        409,
      );
    }

    return buildExportCsv(
      rows.map((row) => buildExportCsvRow(row.metadata, row.transcription)),
    );
  }

  /**
   * Builds the Omeka transcriptions CSV for a single approved document.
   * Used by the Past verifications tab's per-row download action.
   */
  async exportSingleTranscriptionCsv(documentId: string): Promise<string> {
    const record = await this.repository.getDocumentRecord(documentId);
    if (!record) {
      throw new AppError("NOT_FOUND", "Document was not found.", 404);
    }
    return buildExportCsv([
      buildExportCsvRow(record.metadata, record.transcription),
    ]);
  }
}

function rangeLabel(document: DocumentPackage): string {
  const pages = document.pages;
  if (pages.length === 0) return "-";
  const start = pages[0].sourcePage;
  const end = pages[pages.length - 1].sourcePage;
  return start === end ? `${start}` : `${start}-${end}`;
}

function signedDelta(value: number): string {
  if (value === 0) return "±0";
  return value > 0 ? `+${value}` : `${value}`;
}

async function buildBatchZip(rows: BatchExportRow[]): Promise<{
  bytes: Uint8Array;
  fileName: string;
  documentCount: number;
}> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const exportedAt = new Date().toISOString();

  zip.file(
    "taep-index.csv",
    buildTaepIndexCsv(
      rows.map((row) => buildTaepIndexRow(row.metadata, exportedAt)),
    ),
  );
  zip.file(
    "omeka-import.csv",
    buildExportCsv(
      rows.map((row) => buildExportCsvRow(row.metadata, row.transcription)),
    ),
  );
  zip.file(
    "manifest.json",
    JSON.stringify(
      {
        exportedAt,
        documentCount: rows.length,
        documents: rows.map((row) => ({
          documentId: row.document.documentId,
          folderId: row.document.folderId,
          title: row.document.title,
          status: row.document.status,
          confidence: row.document.confidence,
          sourceFile: row.document.sourceFile,
          transcription: row.transcription,
          metadata: row.metadata,
        })),
      },
      null,
      2,
    ),
  );
  zip.file(
    "README.txt",
    [
      "Edison Automation export",
      `Exported at: ${exportedAt}`,
      `Documents: ${rows.length}`,
      "",
      "Files:",
      "- taep-index.csv        TAEP Omeka-S form index (operator spreadsheet)",
      "- omeka-import.csv      Omeka S CSV Import for edisondigital.rutgers.edu",
      "- manifest.json         Full structured metadata + transcription JSON",
      "- <documentId>/         Per-document folder",
      "    transcription.txt   Diplomatic transcription as plain text",
      "    metadata.json       Extracted metadata (document type, date, names, subjects)",
      "    source.json         Source file descriptor (name, size, mime type)",
    ].join("\n"),
  );

  for (const row of rows) {
    const folder = zip.folder(row.document.documentId);
    if (!folder) continue;
    folder.file(
      "transcription.txt",
      row.transcription.diplomaticText || row.transcription.ocrText || "",
    );
    folder.file("metadata.json", JSON.stringify(row.metadata, null, 2));
    folder.file(
      "source.json",
      JSON.stringify(row.document.sourceFile, null, 2),
    );
  }

  const buffer = await zip.generateAsync({ type: "uint8array" });
  const timestamp = exportedAt
    .replace(/[:.]/g, "-")
    .replace("T", "_")
    .slice(0, 19);
  return {
    bytes: buffer,
    fileName: `edison-batch-${timestamp}.zip`,
    documentCount: rows.length,
  };
}

