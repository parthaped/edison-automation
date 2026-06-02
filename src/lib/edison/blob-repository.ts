import { del, list, put } from "@vercel/blob";
import { extractUncertainReadings, gradeTranscription } from "./confidence";
import type {
  DocumentRecord,
  DocumentRecords,
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

// One JSON record per document, stored at records/<documentId>.json in the
// project's Vercel Blob store. This is durable across serverless invocations
// without provisioning a separate database. Listing is paginated so large
// datasets are not silently truncated at the API page size.

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

async function listAllRecordBlobs() {
  const all: Awaited<ReturnType<typeof list>>["blobs"] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: RECORD_PREFIX, limit: 1000, cursor });
    all.push(...result.blobs);
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return all;
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
    const blobs = await listAllRecordBlobs();
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
    const blobs = await listAllRecordBlobs();
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

    const uncertainReadings = extractUncertainReadings(diplomaticText);
    // Re-grade so the stored confidence reflects the edited text instead of
    // the original AI output.
    const confidence =
      record.document.status === "blocked"
        ? record.document.confidence
        : gradeTranscription({
            pageCount: record.document.pages.length,
            blocked: false,
            text: diplomaticText,
            uncertainReadings: uncertainReadings.length,
          }).bucket;

    const document: DocumentPackage = {
      ...record.document,
      confidence,
      updatedAt: new Date().toISOString(),
    };
    await this.writeRecord({
      document,
      transcription: {
        ...record.transcription,
        diplomaticText,
        uncertainReadings,
      },
      metadata: { ...record.metadata, confidence },
    });
    return document;
  }

  async approveDocument(documentId: string): Promise<DocumentPackage | null> {
    const record = await this.readRecord(documentId);
    if (!record) return null;

    const document: DocumentPackage = {
      ...record.document,
      status: "approved",
      updatedAt: new Date().toISOString(),
    };
    await this.writeRecord({
      document,
      transcription: record.transcription,
      metadata: record.metadata,
    });
    return document;
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    const path = recordPath(documentId);
    const { blobs } = await list({ prefix: path, limit: 1 });
    const match = blobs.find((blob) => blob.pathname === path);
    if (!match) return false;
    try {
      await del(match.url);
      return true;
    } catch {
      return false;
    }
  }

  async getReviewCase(documentId?: string): Promise<ReviewCase | null> {
    return buildReviewCase(await this.listDocumentRecords(), documentId);
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

  async listGroupSiblings(groupId: string): Promise<DocumentRecord[]> {
    const records = await this.readAllRecords();
    return records
      .filter((record) => record.document.sourceGroup?.groupId === groupId)
      .sort(
        (a, b) =>
          (a.document.sourceGroup?.position ?? 0) -
          (b.document.sourceGroup?.position ?? 0),
      );
  }

  async replaceGroupSiblings(
    groupId: string,
    nextSiblings: DocumentRecord[],
  ): Promise<void> {
    const existing = await this.listGroupSiblings(groupId);
    const keepIds = new Set(
      nextSiblings.map((record) => record.document.documentId),
    );
    // Delete blob records for siblings that no longer belong to the group.
    // We resolve each obsolete record to its current blob URL via `list` and
    // call `del` on it; if the blob is already missing we silently move on.
    for (const obsolete of existing) {
      if (keepIds.has(obsolete.document.documentId)) continue;
      const path = recordPath(obsolete.document.documentId);
      const { blobs } = await list({ prefix: path, limit: 1 });
      const match = blobs.find((blob) => blob.pathname === path);
      if (match) {
        try {
          await del(match.url);
        } catch {
          // Best-effort cleanup; a leaked record can be removed manually.
        }
      }
    }
    for (const record of nextSiblings) {
      await this.writeRecord(record);
    }
  }
}
