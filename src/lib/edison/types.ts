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
  // Populated when this page could not be rendered (e.g. PDF rasterization
  // failed). The viewer surfaces this in the source-image placeholder so the
  // reviewer can see *why* the image is missing instead of an empty frame.
  renderError?: string;
}

// Identifies a cluster of DocumentPackages that were all extracted from the
// same uploaded source file (typically a multi-document PDF). One source PDF
// becomes one `groupId`; each detected sub-document becomes its own
// DocumentPackage that shares the group. A single-document upload still gets
// a sourceGroup with one sibling so the data model is uniform.
export interface SourceGroup {
  groupId: string;
  originalFileName: string;
  // 0-based position of this sibling within the group, ordered by the
  // sub-document's page range. Used for stable navigation and id suffixing.
  position: number;
  // Document ids of every sibling (including this one), in document order.
  // Lets the viewer show a quick navigator without an extra repository
  // round-trip.
  siblingIds: string[];
  // The total page count of the parent PDF, retained so the splits editor
  // can validate that user-edited ranges stay within the source.
  totalPages: number;
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
  // Present when this document was extracted from a multi-document source
  // (or a single-document source with split metadata). Used by the reviewer
  // workbench to surface siblings and the split editor.
  sourceGroup?: SourceGroup;
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
  title: string;
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
