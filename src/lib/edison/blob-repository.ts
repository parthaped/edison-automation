import { list, put } from "@vercel/blob";
import type {
  DocumentRecord,
  DocumentRecords,
  EdisonRepository,
  ReviewCase,
} from "./repositories";
import type {
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "./types";

// One JSON record per document, stored at records/<documentId>.json in the
// project's Vercel Blob store. This is durable across serverless invocations
// without provisioning a separate database. The dataset is small (one record
// per ingested document) so listing + reading every record per dashboard load
// is acceptable.

const RECORD_PREFIX = "records/";

function recordPath(documentId: string): string {
  return `${RECORD_PREFIX}${encodeURIComponent(documentId)}.json`;
}

function documentIdFromPathname(pathname: string): string | null {
  if (!pathname.startsWith(RECORD_PREFIX) || !pathname.endsWith(".json")) {
    return null;
  }
  const encoded = pathname.slice(RECORD_PREFIX.length, -".json".length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export class BlobEdisonRepository implements EdisonRepository {
  private async writeRecord(record: DocumentRecord): Promise<void> {
    await put(
      recordPath(record.document.documentId),
      JSON.stringify(record),
      {
        access: "public",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: true,
        // Disable CDN caching so an overwrite (e.g. a saved edit) is read back
        // immediately instead of serving a stale copy.
        cacheControlMaxAge: 0,
      },
    );
  }

  private async readAllRecords(): Promise<DocumentRecord[]> {
    const { blobs } = await list({ prefix: RECORD_PREFIX, limit: 1000 });
    const records = await Promise.all(
      blobs.map(async (blob) => {
        try {
          const response = await fetch(blob.url, { cache: "no-store" });
          if (!response.ok) return null;
          return (await response.json()) as DocumentRecord;
        } catch {
          return null;
        }
      }),
    );
    return records.filter((record): record is DocumentRecord => record !== null);
  }

  private async readRecord(documentId: string): Promise<DocumentRecord | null> {
    const path = recordPath(documentId);
    const { blobs } = await list({ prefix: path, limit: 1 });
    const match = blobs.find((blob) => blob.pathname === path);
    if (!match) return null;
    try {
      const response = await fetch(match.url, { cache: "no-store" });
      if (!response.ok) return null;
      return (await response.json()) as DocumentRecord;
    } catch {
      return null;
    }
  }

  async listDocuments(): Promise<DocumentPackage[]> {
    const records = await this.readAllRecords();
    return records
      .map((record) => record.document)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async listDocumentIds(): Promise<string[]> {
    // Only the blob index is needed; record bodies are never fetched. The
    // document ID is encoded in the pathname (records/<id>.json).
    const { blobs } = await list({ prefix: RECORD_PREFIX, limit: 1000 });
    return blobs
      .map((blob) => documentIdFromPathname(blob.pathname))
      .filter((id): id is string => id !== null);
  }

  async getDocumentRecord(documentId: string): Promise<DocumentRecord | null> {
    return this.readRecord(documentId);
  }

  async listDocumentRecords(): Promise<DocumentRecords> {
    const records = await this.readAllRecords();
    const documents = records
      .map((record) => record.document)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    const transcriptions: Record<string, TranscriptionRun> = {};
    const metadata: Record<string, MetadataExtraction> = {};
    for (const record of records) {
      transcriptions[record.document.documentId] = record.transcription;
      metadata[record.document.documentId] = record.metadata;
    }
    return { documents, transcriptions, metadata };
  }

  async saveDocuments(documents: DocumentPackage[]): Promise<void> {
    for (const document of documents) {
      const existing = await this.readRecord(document.documentId);
      await this.writeRecord({
        document,
        transcription:
          existing?.transcription ?? emptyTranscription(document.documentId),
        metadata: existing?.metadata ?? emptyMetadata(document),
      });
    }
  }

  async saveProcessedDocuments(
    documents: DocumentPackage[],
    transcriptions: TranscriptionRun[],
    metadata: MetadataExtraction[],
  ): Promise<void> {
    const transcriptionsById = new Map(
      transcriptions.map((entry) => [entry.documentId, entry]),
    );
    const metadataById = new Map(
      metadata.map((entry) => [entry.documentId, entry]),
    );
    for (const document of documents) {
      await this.writeRecord({
        document,
        transcription:
          transcriptionsById.get(document.documentId) ??
          emptyTranscription(document.documentId),
        metadata: metadataById.get(document.documentId) ?? emptyMetadata(document),
      });
    }
  }

  async saveProcessedDocument(
    document: DocumentPackage,
    transcription: TranscriptionRun,
    metadata: MetadataExtraction,
  ): Promise<void> {
    await this.writeRecord({ document, transcription, metadata });
  }

  async updateTranscriptionText(
    documentId: string,
    diplomaticText: string,
  ): Promise<DocumentPackage | null> {
    const record = await this.readRecord(documentId);
    if (!record) return null;

    const document: DocumentPackage = {
      ...record.document,
      updatedAt: new Date().toISOString(),
    };
    await this.writeRecord({
      document,
      transcription: {
        ...record.transcription,
        diplomaticText,
        uncertainReadings: diplomaticText.match(/\[[^\]]+\?\]/g) ?? [],
      },
      metadata: record.metadata,
    });
    return document;
  }

  async getReviewCase(documentId?: string): Promise<ReviewCase | null> {
    const records = await this.readAllRecords();
    if (records.length === 0) return null;

    const byId = new Map(
      records.map((record) => [record.document.documentId, record]),
    );
    const allDocuments = records
      .map((record) => record.document)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));

    const reviewable = allDocuments.filter((document) =>
      ["needs_review", "blocked"].includes(document.status),
    );
    const documents = reviewable.length > 0 ? reviewable : allDocuments;
    const selected =
      documents.find((document) => document.documentId === documentId) ??
      documents[0];

    const transcriptions: Record<string, TranscriptionRun> = {};
    const metadata: Record<string, MetadataExtraction> = {};
    for (const document of documents) {
      const record = byId.get(document.documentId);
      transcriptions[document.documentId] =
        record?.transcription ?? emptyTranscription(document.documentId);
      metadata[document.documentId] = record?.metadata ?? emptyMetadata(document);
    }

    return {
      documents,
      selectedDocumentId: selected.documentId,
      transcriptions,
      metadata,
    };
  }

  async listApprovedExportRows() {
    const records = await this.readAllRecords();
    return records
      .filter((record) => record.document.status === "approved")
      .map((record) => ({
        metadata: record.metadata,
        transcription: record.transcription,
      }));
  }

  async listExportRowsByIds(documentIds: string[]) {
    const rows: Array<{
      document: DocumentPackage;
      metadata: MetadataExtraction;
      transcription: TranscriptionRun;
    }> = [];
    for (const documentId of documentIds) {
      const record = await this.readRecord(documentId);
      if (!record) continue;
      rows.push({
        document: record.document,
        metadata: record.metadata,
        transcription: record.transcription,
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
