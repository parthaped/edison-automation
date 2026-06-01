import type {
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "./types";

export interface DashboardSummary {
  total: number;
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
}

export function summarizeDocuments(
  documents: DocumentPackage[],
): DashboardSummary {
  return {
    total: documents.length,
    lowConfidence: documents.filter((document) => document.confidence === "low").length,
    mediumConfidence: documents.filter((document) => document.confidence === "medium").length,
    blocked: documents.filter((document) => document.status === "blocked").length,
    readyToExport: documents.filter((document) => document.status === "approved").length,
  };
}
