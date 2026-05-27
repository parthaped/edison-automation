export type SupportedFileKind =
  | "pdf"
  | "jpeg"
  | "png"
  | "tiff"
  | "webp"
  | "gif"
  | "docx"
  | "csv";

export type ConfidenceBucket = "high" | "medium" | "low" | "blocked";

export type ProcessingStatus =
  | "queued"
  | "extracting"
  | "transcribing"
  | "needs_review"
  | "approved"
  | "exported"
  | "blocked";

export type ReviewDecision =
  | "edited_transcription"
  | "marked_uncertain"
  | "corrected_metadata"
  | "split_pages"
  | "merged_pages"
  | "flagged_manual_review"
  | "approved"
  | "rejected";

export interface SourceFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  boxFileId?: string;
  checksum?: string;
}

export interface ValidationResult {
  accepted: boolean;
  kind?: SupportedFileKind;
  reason?: string;
  warnings: string[];
}

export interface PageImage {
  id: string;
  documentId: string;
  pageIndex: number;
  imageFilename: string;
  sourcePage: number;
  checksum?: string;
  width?: number;
  height?: number;
  omekaMediaId?: number;
  originalUrl?: string;
}

export interface DocumentPackage {
  id: string;
  folderId: string;
  documentId: string;
  title: string;
  sourceFile: SourceFile;
  pages: PageImage[];
  status: ProcessingStatus;
  confidence: ConfidenceBucket;
  validationWarnings: string[];
  uncertaintyNotes: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptionRun {
  id: string;
  documentId: string;
  model: string;
  promptVersion: string;
  ocrText: string;
  diplomaticText: string;
  normalizedText?: string;
  uncertainReadings: string[];
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface MetadataExtraction {
  folderId: string;
  documentId: string;
  documentType: string;
  date: string;
  authors: string[];
  recipients: string[];
  mentionedNames: string[];
  subjects: string[];
  imageNames: string[];
  confidence: ConfidenceBucket;
}

export interface ReviewEvent {
  id: string;
  documentId: string;
  reviewer: string;
  decision: ReviewDecision;
  note: string;
  createdAt: string;
}

export type FeedbackTarget =
  | "transcription"
  | "metadata"
  | "confidence"
  | "file-extraction"
  | "prompt";

export interface AgentFeedback {
  id: string;
  documentId: string;
  reviewer: string;
  target: FeedbackTarget;
  promptVersion?: string;
  model?: string;
  originalValue: string;
  correctedValue: string;
  issueTags: string[];
  confidenceBefore?: ConfidenceBucket;
  confidenceAfter?: ConfidenceBucket;
  createdAt: string;
}

export interface PromptRevisionCandidate {
  id: string;
  task: PromptVersion["task"];
  basePromptVersion: string;
  proposedPrompt: string;
  rationale: string;
  supportingFeedbackIds: string[];
  status: "draft" | "approved" | "rejected";
  createdAt: string;
}

export interface ConfidenceCalibrationSuggestion {
  id: string;
  reason: string;
  suggestedBucket: ConfidenceBucket;
  supportingFeedbackIds: string[];
  createdAt: string;
}

export interface PromptVersion {
  id: string;
  task:
    | "ocr-cleanup"
    | "diplomatic-transcription"
    | "normalized-transcription"
    | "metadata-extraction"
    | "summary"
    | "consensus";
  version: string;
  prompt: string;
  active: boolean;
}
