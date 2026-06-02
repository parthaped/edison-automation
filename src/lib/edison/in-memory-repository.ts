import { extractUncertainReadings, gradeTranscription } from "./confidence";
import { sampleDocuments, sampleMetadata, sampleTranscription } from "./sample-data";
import type {
  DocumentRecord,
  DocumentRecords,
  DocumentRecordsPage,
  EdisonRepository,
  ReviewCase,
} from "./repositories";
import {
  buildReviewCase,
  emptyMetadata,
  emptyTranscription,
} from "./repositories";
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

  async listDocumentIds(): Promise<string[]> {
    return [...this.documents.keys()];
  }

  async getDocumentRecord(documentId: string): Promise<DocumentRecord | null> {
    const document = this.documents.get(documentId);
    if (!document) return null;
    return {
      document,
      transcription:
        this.transcriptions.get(documentId) ?? emptyTranscription(documentId),
      metadata: this.metadata.get(documentId) ?? emptyMetadata(document),
    };
  }

  async listDocumentRecords(): Promise<DocumentRecords> {
    const documents = await this.listDocuments();
    const transcriptions: Record<string, TranscriptionRun> = {};
    const metadata: Record<string, MetadataExtraction> = {};
    for (const document of documents) {
      transcriptions[document.documentId] =
        this.transcriptions.get(document.documentId) ??
        emptyTranscription(document.documentId);
      metadata[document.documentId] =
        this.metadata.get(document.documentId) ?? emptyMetadata(document);
    }
    return { documents, transcriptions, metadata };
  }

  async listDocumentRecordsPage(input: {
    offset: number;
    limit: number;
  }): Promise<DocumentRecordsPage> {
    const all = await this.listDocumentRecords();
    const offset = Math.max(0, input.offset);
    const limit = Math.max(1, input.limit);
    const documents = all.documents.slice(offset, offset + limit);
    const transcriptions: Record<string, TranscriptionRun> = {};
    const metadata: Record<string, MetadataExtraction> = {};
    for (const document of documents) {
      transcriptions[document.documentId] = all.transcriptions[document.documentId];
      metadata[document.documentId] = all.metadata[document.documentId];
    }
    return {
      documents,
      transcriptions,
      metadata,
      totalCount: all.documents.length,
      offset,
      limit,
      hasMore: offset + limit < all.documents.length,
    };
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

  async updateTranscriptionText(
    documentId: string,
    diplomaticText: string,
  ): Promise<DocumentPackage | null> {
    const document = this.documents.get(documentId);
    if (!document) return null;

    const existing =
      this.transcriptions.get(documentId) ?? emptyTranscription(documentId);
    const uncertainReadings = extractUncertainReadings(diplomaticText);
    this.transcriptions.set(documentId, {
      ...existing,
      diplomaticText,
      uncertainReadings,
    });

    // Re-grade so the stored confidence reflects the edited text instead of
    // the original AI output.
    const confidence =
      document.status === "blocked"
        ? document.confidence
        : gradeTranscription({
            pageCount: document.pages.length,
            blocked: false,
            text: diplomaticText,
            uncertainReadings: uncertainReadings.length,
          }).bucket;

    const updated: DocumentPackage = {
      ...document,
      confidence,
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(documentId, updated);

    const metadata = this.metadata.get(documentId);
    if (metadata) {
      this.metadata.set(documentId, { ...metadata, confidence });
    }

    return updated;
  }

  async approveDocument(documentId: string): Promise<DocumentPackage | null> {
    const document = this.documents.get(documentId);
    if (!document) return null;

    const updated: DocumentPackage = {
      ...document,
      status: "approved",
      updatedAt: new Date().toISOString(),
    };
    this.documents.set(documentId, updated);
    return updated;
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    if (!this.documents.has(documentId)) return false;
    this.documents.delete(documentId);
    this.transcriptions.delete(documentId);
    this.metadata.delete(documentId);
    return true;
  }

  async getReviewCase(documentId?: string): Promise<ReviewCase | null> {
    return buildReviewCase(await this.listDocumentRecords(), documentId);
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

  async listGroupSiblings(groupId: string): Promise<DocumentRecord[]> {
    const siblings: DocumentRecord[] = [];
    for (const document of this.documents.values()) {
      if (document.sourceGroup?.groupId !== groupId) continue;
      siblings.push({
        document,
        transcription:
          this.transcriptions.get(document.documentId) ??
          emptyTranscription(document.documentId),
        metadata:
          this.metadata.get(document.documentId) ?? emptyMetadata(document),
      });
    }
    return siblings.sort(
      (a, b) =>
        (a.document.sourceGroup?.position ?? 0) -
        (b.document.sourceGroup?.position ?? 0),
    );
  }

  async replaceGroupSiblings(
    groupId: string,
    nextSiblings: DocumentRecord[],
  ): Promise<void> {
    const keepIds = new Set(
      nextSiblings.map((record) => record.document.documentId),
    );
    const obsolete: string[] = [];
    for (const [documentId, document] of this.documents.entries()) {
      if (document.sourceGroup?.groupId !== groupId) continue;
      if (!keepIds.has(documentId)) obsolete.push(documentId);
    }
    for (const documentId of obsolete) {
      this.documents.delete(documentId);
      this.transcriptions.delete(documentId);
      this.metadata.delete(documentId);
    }
    for (const record of nextSiblings) {
      this.documents.set(record.document.documentId, record.document);
      this.transcriptions.set(record.document.documentId, record.transcription);
      this.metadata.set(record.document.documentId, record.metadata);
    }
  }
}
