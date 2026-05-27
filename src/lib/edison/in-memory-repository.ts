import {
  sampleDocuments,
  sampleMetadata,
  sampleReviewEvents,
  sampleTranscription,
} from "./sample-data";
import type { EdisonRepository, ReviewCase } from "./repositories";
import type {
  AgentFeedback,
  DocumentPackage,
  MetadataExtraction,
  PromptRevisionCandidate,
  ReviewEvent,
  TranscriptionRun,
} from "./types";

export class InMemoryEdisonRepository implements EdisonRepository {
  private documents = new Map<string, DocumentPackage>();
  private transcriptions = new Map<string, TranscriptionRun>();
  private metadata = new Map<string, MetadataExtraction>();
  private reviewEvents: ReviewEvent[] = [];
  private agentFeedback: AgentFeedback[] = [];
  private promptRevisionCandidates: PromptRevisionCandidate[] = [];

  constructor(seed = true) {
    if (seed) {
      this.saveSeedData();
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
      reviewEvents: this.reviewEvents.filter(
        (event) => event.documentId === selected.documentId,
      ),
    };
  }

  async listApprovedExportRows() {
    const approved = [...this.documents.values()].filter(
      (document) => document.status === "approved" || document.status === "needs_review",
    );

    return approved.map((document) => ({
      metadata: this.metadata.get(document.documentId) ?? emptyMetadata(document),
      transcription:
        this.transcriptions.get(document.documentId) ??
        emptyTranscription(document.documentId),
    }));
  }

  async appendReviewEvent(event: ReviewEvent): Promise<void> {
    this.reviewEvents.push(event);
  }

  async appendAgentFeedback(feedback: AgentFeedback): Promise<void> {
    this.agentFeedback.push(feedback);
  }

  async listAgentFeedback(): Promise<AgentFeedback[]> {
    return [...this.agentFeedback].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  async savePromptRevisionCandidate(candidate: PromptRevisionCandidate): Promise<void> {
    this.promptRevisionCandidates.push(candidate);
  }

  async listPromptRevisionCandidates(): Promise<PromptRevisionCandidate[]> {
    return [...this.promptRevisionCandidates].sort((a, b) =>
      a.createdAt < b.createdAt ? 1 : -1,
    );
  }

  private saveSeedData() {
    for (const document of sampleDocuments) {
      this.documents.set(document.documentId, document);
    }
    this.transcriptions.set(sampleTranscription.documentId, sampleTranscription);
    this.metadata.set(sampleMetadata.documentId, sampleMetadata);
    this.reviewEvents = [...sampleReviewEvents];
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
