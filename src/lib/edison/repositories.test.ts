import { describe, expect, it } from "vitest";
import { InMemoryEdisonRepository } from "./in-memory-repository";
import { sampleDocuments, sampleMetadata, sampleTranscription } from "./sample-data";
import { buildReviewCase, type DocumentRecords } from "./repositories";
import { resolvePersistedDocumentStatus } from "./service";
import type { DocumentPackage } from "./types";

function makeRecords(
  documents: DocumentPackage[],
  options?: {
    omitTranscriptionFor?: string;
  },
): DocumentRecords {
  const transcriptions: DocumentRecords["transcriptions"] = {};
  const metadata: DocumentRecords["metadata"] = {};
  for (const document of documents) {
    if (document.documentId !== options?.omitTranscriptionFor) {
      transcriptions[document.documentId] = {
        ...sampleTranscription,
        id: `${document.documentId}-run-1`,
        documentId: document.documentId,
      };
    }
    metadata[document.documentId] = {
      ...sampleMetadata,
      documentId: document.documentId,
      folderId: document.folderId,
    };
  }
  return { documents, transcriptions, metadata };
}

describe("buildReviewCase", () => {
  it("includes and selects an approved document when deep-linked by id", () => {
    const needsReview = sampleDocuments[0];
    const approved: DocumentPackage = {
      ...sampleDocuments[1],
      documentId: "APPROVED-001",
      id: "APPROVED-001",
      status: "approved",
    };
    const records = makeRecords([needsReview, approved]);

    const reviewCase = buildReviewCase(records, "APPROVED-001");

    expect(reviewCase?.selectedDocumentId).toBe("APPROVED-001");
    expect(reviewCase?.documents.map((document) => document.documentId)).toContain(
      "APPROVED-001",
    );
    expect(reviewCase?.documents.map((document) => document.documentId)).toContain(
      needsReview.documentId,
    );
  });

  it("falls back to the first reviewable document for an invalid document id", () => {
    const records = makeRecords(sampleDocuments.slice(0, 2));

    const reviewCase = buildReviewCase(records, "DOES-NOT-EXIST");

    expect(reviewCase?.selectedDocumentId).toBe(sampleDocuments[0].documentId);
  });

  it("returns empty transcription fallbacks when sidecars are missing", () => {
    const records = makeRecords([sampleDocuments[0]], {
      omitTranscriptionFor: sampleDocuments[0].documentId,
    });

    const reviewCase = buildReviewCase(records);

    const transcription =
      reviewCase?.transcriptions[sampleDocuments[0].documentId];
    expect(transcription).toBeDefined();
    expect(transcription?.diplomaticText).toBe("");
    expect(transcription?.model).toBe("not-run");
  });

  it("returns null when there are no documents", () => {
    expect(buildReviewCase({ documents: [], transcriptions: {}, metadata: {} })).toBeNull();
  });
});

describe("InMemoryEdisonRepository.deleteDocument", () => {
  it("removes the document and its sidecars", async () => {
    const repository = new InMemoryEdisonRepository(true);

    expect(await repository.deleteDocument("D9032-00001")).toBe(true);
    expect(await repository.getDocumentRecord("D9032-00001")).toBeNull();
    expect(await repository.deleteDocument("D9032-00001")).toBe(false);
  });
});

describe("buildReviewCase with persisted queue promotion", () => {
  it("includes needs_review documents alongside existing reviewable records", async () => {
    const repository = new InMemoryEdisonRepository(false);
    const needsReview = sampleDocuments[0];
    const queuedWithPages: DocumentPackage = {
      ...sampleDocuments[1],
      documentId: "QUEUED-001",
      id: "QUEUED-001",
      status: "queued",
    };
    const promoted = resolvePersistedDocumentStatus(queuedWithPages);

    await repository.saveDocuments([needsReview, promoted]);

    const reviewCase = await repository.getReviewCase();

    expect(reviewCase?.documents.map((document) => document.documentId)).toEqual(
      expect.arrayContaining([needsReview.documentId, "QUEUED-001"]),
    );
  });
});
