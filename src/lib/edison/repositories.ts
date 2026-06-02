import type {
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "./types";

export interface DashboardSummary {
  total: number;
  highConfidence: number;
  lowConfidence: number;
  mediumConfidence: number;
  blocked: number;
  readyToExport: number;
}

export interface DocumentRecords {
  documents: DocumentPackage[];
  transcriptions: Record<string, TranscriptionRun>;
  metadata: Record<string, MetadataExtraction>;
}

export interface ReviewCase {
  documents: DocumentPackage[];
  selectedDocumentId: string;
  transcriptions: Record<string, TranscriptionRun>;
  metadata: Record<string, MetadataExtraction>;
}

export interface DocumentRecord {
  document: DocumentPackage;
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
}

export interface EdisonRepository {
  listDocuments(): Promise<DocumentPackage[]>;
  // Lightweight listing of just the document identifiers. Used by the ingest
  // workflow to assign collision-free IDs without fetching every record body.
  listDocumentIds(): Promise<string[]>;
  listDocumentRecords(): Promise<DocumentRecords>;
  getDocumentRecord(documentId: string): Promise<DocumentRecord | null>;
  saveDocuments(documents: DocumentPackage[]): Promise<void>;
  saveProcessedDocuments(
    documents: DocumentPackage[],
    transcriptions: TranscriptionRun[],
    metadata: MetadataExtraction[],
  ): Promise<void>;
  saveProcessedDocument(
    document: DocumentPackage,
    transcription: TranscriptionRun,
    metadata: MetadataExtraction,
  ): Promise<void>;
  updateTranscriptionText(
    documentId: string,
    diplomaticText: string,
  ): Promise<DocumentPackage | null>;
  // Marks a document approved so it is included in the transcriptions CSV
  // export. Returns the updated package, or null when the document is unknown.
  approveDocument(documentId: string): Promise<DocumentPackage | null>;
  getReviewCase(documentId?: string): Promise<ReviewCase | null>;
  listApprovedExportRows(): Promise<
    Array<{
      metadata: MetadataExtraction;
      transcription: TranscriptionRun;
    }>
  >;
  listExportRowsByIds(documentIds: string[]): Promise<
    Array<{
      document: DocumentPackage;
      metadata: MetadataExtraction;
      transcription: TranscriptionRun;
    }>
  >;
  // Returns every sibling DocumentRecord that shares a `sourceGroup.groupId`,
  // ordered by `sourceGroup.position`. Used by the splits editor to load the
  // current set of siblings before replacing them.
  listGroupSiblings(groupId: string): Promise<DocumentRecord[]>;
  // Atomically replaces the entire set of siblings for a given group: removes
  // any existing siblings whose ids are not in the new set, then writes every
  // record in `nextSiblings`. Used by the splits editor when the reviewer
  // changes page ranges (which can add, drop, or rename siblings).
  replaceGroupSiblings(
    groupId: string,
    nextSiblings: DocumentRecord[],
  ): Promise<void>;
}

export function summarizeDocuments(
  documents: DocumentPackage[],
): DashboardSummary {
  return {
    total: documents.length,
    highConfidence: documents.filter((document) => document.confidence === "high").length,
    lowConfidence: documents.filter((document) => document.confidence === "low").length,
    mediumConfidence: documents.filter((document) => document.confidence === "medium").length,
    blocked: documents.filter((document) => document.status === "blocked").length,
    readyToExport: documents.filter((document) => document.status === "approved").length,
  };
}

export function emptyTranscription(documentId: string): TranscriptionRun {
  return {
    id: `${documentId}-pending-transcription`,
    documentId,
    model: "not-run",
    promptVersion: "not-run",
    ocrText: "",
    diplomaticText: "",
    uncertainReadings: [],
  };
}

export function emptyMetadata(document: DocumentPackage): MetadataExtraction {
  return {
    folderId: document.folderId,
    documentId: document.documentId,
    title: document.title,
    documentType: "Unknown",
    date: "Unknown",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
    imageNames: document.pages.map((page) => page.imageFilename),
    confidence: document.confidence,
  };
}

export function buildReviewCase(
  records: DocumentRecords,
  documentId?: string,
): ReviewCase | null {
  const allDocuments = records.documents;
  if (allDocuments.length === 0) return null;

  const requested = documentId
    ? allDocuments.find((document) => document.documentId === documentId)
    : undefined;

  const reviewable = allDocuments.filter((document) =>
    ["needs_review", "blocked"].includes(document.status),
  );
  let documents = reviewable.length > 0 ? reviewable : allDocuments;

  if (
    requested &&
    !documents.some((document) => document.documentId === documentId)
  ) {
    documents = [requested, ...documents];
  }

  const selected =
    documents.find((document) => document.documentId === documentId) ??
    documents[0];

  const transcriptions: Record<string, TranscriptionRun> = {};
  const metadata: Record<string, MetadataExtraction> = {};
  for (const document of documents) {
    transcriptions[document.documentId] =
      records.transcriptions[document.documentId] ??
      emptyTranscription(document.documentId);
    metadata[document.documentId] =
      records.metadata[document.documentId] ?? emptyMetadata(document);
  }

  return {
    documents,
    selectedDocumentId: selected.documentId,
    transcriptions,
    metadata,
  };
}
