export type SupportedFileKind =
  | "pdf"
  | "jpeg"
  | "png"
  | "tiff"
  | "webp"
  | "gif";

export type ConfidenceBucket = "high" | "medium" | "low" | "blocked";

export type ProcessingStatus =
  | "queued"
  | "extracting"
  | "transcribing"
  | "needs_review"
  | "approved"
  | "exported"
  | "blocked";

export interface SourceFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
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

export interface PromptVersion {
  id: string;
  task: "diplomatic-transcription" | "metadata-extraction" | "project-notebook";
  version: string;
  prompt: string;
  active: boolean;
}
