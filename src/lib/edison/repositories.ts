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

export interface ReviewCase {
  documents: DocumentPackage[];
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
}

export interface EdisonRepository {
  listDocuments(): Promise<DocumentPackage[]>;
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
