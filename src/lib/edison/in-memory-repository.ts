import { sampleDocuments, sampleMetadata, sampleTranscription } from "./sample-data";
import type { EdisonRepository, ReviewCase } from "./repositories";
import type {
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "./types";

export class InMemoryEdisonRepository implements EdisonRepository {
  private documents = new Map<string, DocumentPackage>();
  private transcriptions = new Map<string, TranscriptionRun>();
  private metadata = new Map<string, MetadataExtraction>();

  constructor(seed = true) {
    if (seed) {
      for (const document of sampleDocuments) {
        this.documents.set(document.documentId, document);
      }
      this.transcriptions.set(sampleTranscription.documentId, sampleTranscription);
      this.metadata.set(sampleMetadata.documentId, sampleMetadata);
    }
  }

  async listDocuments(): Promise<DocumentPackage[]> {
    return [...this.documents.values()].sort((a, b) =>
      a.updatedAt < b.updatedAt ? 1 : -1,
    );
  }

  async saveDocuments(documents: DocumentPackage[]): Promise<void> {
    for (const document of documents) {
      this.documents.set(document.documentId, document);
      if (!this.transcriptions.has(document.documentId)) {
        this.transcriptions.set(document.documentId, emptyTranscription(document.documentId));
      }
      if (!this.metadata.has(document.documentId)) {
        this.metadata.set(document.documentId, emptyMetadata(document));
      }
    }
  }

  async saveProcessedDocuments(
    documents: DocumentPackage[],
    transcriptions: TranscriptionRun[],
    metadata: MetadataExtraction[],
  ): Promise<void> {
    for (const document of documents) {
      this.documents.set(document.documentId, document);
    }
    for (const transcription of transcriptions) {
      this.transcriptions.set(transcription.documentId, transcription);
    }
    for (const item of metadata) {
      this.metadata.set(item.documentId, item);
    }
  }

  async saveProcessedDocument(
    document: DocumentPackage,
    transcription: TranscriptionRun,
    metadata: MetadataExtraction,
  ): Promise<void> {
    this.documents.set(document.documentId, document);
    this.transcriptions.set(transcription.documentId, transcription);
    this.metadata.set(metadata.documentId, metadata);
  }

  async getReviewCase(documentId?: string): Promise<ReviewCase | null> {
    const documents = await this.listDocuments();
    if (documents.length === 0) return null;

    const reviewable = documents.filter((document) =>
      ["needs_review", "blocked"].includes(document.status),
    );
    const selected =
      documents.find((document) => document.documentId === documentId) ??
      reviewable[0] ??
      documents[0];

    return {
      documents: reviewable.length > 0 ? reviewable : documents,
      transcription:
        this.transcriptions.get(selected.documentId) ?? emptyTranscription(selected.documentId),
      metadata: this.metadata.get(selected.documentId) ?? emptyMetadata(selected),
    };
  }

  async listApprovedExportRows() {
    const approved = [...this.documents.values()].filter(
      (document) => document.status === "approved",
    );

    return approved.map((document) => ({
      metadata: this.metadata.get(document.documentId) ?? emptyMetadata(document),
      transcription:
        this.transcriptions.get(document.documentId) ??
        emptyTranscription(document.documentId),
    }));
  }

  async listExportRowsByIds(documentIds: string[]) {
    const rows: Array<{
      document: DocumentPackage;
      metadata: MetadataExtraction;
      transcription: TranscriptionRun;
    }> = [];
    for (const documentId of documentIds) {
      const document = this.documents.get(documentId);
      if (!document) continue;
      rows.push({
        document,
        metadata: this.metadata.get(documentId) ?? emptyMetadata(document),
        transcription:
          this.transcriptions.get(documentId) ?? emptyTranscription(documentId),
      });
    }
    return rows;
  }
}

function emptyTranscription(documentId: string): TranscriptionRun {
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

function emptyMetadata(document: DocumentPackage): MetadataExtraction {
  return {
    folderId: document.folderId,
    documentId: document.documentId,
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
