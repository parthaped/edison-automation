import type {
  AgentFeedback,
  BoxUpload,
  DocumentPackage,
  MetadataExtraction,
  PromptRevisionCandidate,
  ReviewEvent,
  TranscriptionRun,
} from "./types";

export interface DashboardSummary {
  total: number;
  lowConfidence: number;
  mediumConfidence: number;
  blocked: number;
  readyToExport: number;
  pendingBoxUploads: number;
}

export interface ReviewCase {
  documents: DocumentPackage[];
  transcription: TranscriptionRun;
  metadata: MetadataExtraction;
  reviewEvents: ReviewEvent[];
}

export interface EdisonRepository {
  listDocuments(): Promise<DocumentPackage[]>;
  saveDocuments(documents: DocumentPackage[]): Promise<void>;
  listBoxUploads(): Promise<BoxUpload[]>;
  saveBoxUpload(upload: BoxUpload): Promise<void>;
  updateBoxUpload(upload: BoxUpload): Promise<void>;
  getBoxUpload(id: string): Promise<BoxUpload | null>;
  getReviewCase(documentId?: string): Promise<ReviewCase | null>;
  listApprovedExportRows(): Promise<
    Array<{
      metadata: MetadataExtraction;
      transcription: TranscriptionRun;
    }>
  >;
  appendReviewEvent(event: ReviewEvent): Promise<void>;
  appendAgentFeedback(feedback: AgentFeedback): Promise<void>;
  listAgentFeedback(): Promise<AgentFeedback[]>;
  savePromptRevisionCandidate(candidate: PromptRevisionCandidate): Promise<void>;
  listPromptRevisionCandidates(): Promise<PromptRevisionCandidate[]>;
}

export function summarizeDocuments(
  documents: DocumentPackage[],
  boxUploads: BoxUpload[] = [],
): DashboardSummary {
  return {
    total: documents.length,
    lowConfidence: documents.filter((document) => document.confidence === "low").length,
    mediumConfidence: documents.filter((document) => document.confidence === "medium").length,
    blocked: documents.filter((document) => document.status === "blocked").length,
    readyToExport: documents.filter((document) => document.status === "approved").length,
    pendingBoxUploads: boxUploads.filter((upload) => upload.status === "available").length,
  };
}
