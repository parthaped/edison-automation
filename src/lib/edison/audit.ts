import type { DocumentRecords } from "./repositories";
import type { ConfidenceBucket, ProcessingStatus } from "./types";

export type AuditEventKind =
  | "ingested"
  | "transcribed"
  | "graded"
  | "status";

export interface AuditEvent {
  id: string;
  documentId: string;
  folderId: string;
  title: string;
  kind: AuditEventKind;
  label: string;
  detail: string;
  confidence: ConfidenceBucket;
  status: ProcessingStatus;
  timestamp: string;
}

// Logical ordering for events that share a timestamp: the most advanced step
// in the pipeline is shown first.
const KIND_RANK: Record<AuditEventKind, number> = {
  status: 0,
  graded: 1,
  transcribed: 2,
  ingested: 3,
};

const STATUS_LABEL: Record<ProcessingStatus, string> = {
  queued: "Queued",
  extracting: "Extracting pages",
  transcribing: "Transcribing",
  needs_review: "Awaiting review",
  approved: "Approved",
  exported: "Exported to Omeka",
  blocked: "Blocked",
};

function formatCost(cost?: number): string {
  if (cost === undefined) return "";
  return ` · $${cost.toFixed(3)}`;
}

/**
 * Derives a time-ordered activity feed from the documents currently held by
 * the repository. There is no dedicated audit log; events are reconstructed
 * from each document's lifecycle fields (ingest, transcription, confidence
 * grade, and status).
 */
export function buildAuditTrail(records: DocumentRecords): AuditEvent[] {
  const events: AuditEvent[] = [];

  for (const document of records.documents) {
    const transcription = records.transcriptions[document.documentId];
    const base = {
      documentId: document.documentId,
      folderId: document.folderId,
      title: document.title,
      confidence: document.confidence,
      status: document.status,
    };

    const pageLabel = `${document.pages.length} page${
      document.pages.length === 1 ? "" : "s"
    }`;
    events.push({
      ...base,
      id: `${document.documentId}-ingested`,
      kind: "ingested",
      label: "Ingested",
      detail: `${document.sourceFile.name} · ${pageLabel}`,
      timestamp: document.createdAt,
    });

    const transcribed =
      transcription &&
      transcription.model !== "not-run" &&
      (transcription.diplomaticText.length > 0 ||
        transcription.ocrText.length > 0);
    if (transcribed) {
      events.push({
        ...base,
        id: `${document.documentId}-transcribed`,
        kind: "transcribed",
        label: "Transcribed",
        detail: `${transcription.model} · prompt v${transcription.promptVersion}${formatCost(transcription.costUsd)}`,
        timestamp: document.updatedAt,
      });
    }

    const uncertain = transcription?.uncertainReadings.length ?? 0;
    events.push({
      ...base,
      id: `${document.documentId}-graded`,
      kind: "graded",
      label: `Graded ${document.confidence} confidence`,
      detail:
        uncertain > 0
          ? `${uncertain} uncertain reading${uncertain === 1 ? "" : "s"} flagged`
          : "No uncertain readings flagged",
      timestamp: document.updatedAt,
    });

    events.push({
      ...base,
      id: `${document.documentId}-status`,
      kind: "status",
      label: STATUS_LABEL[document.status],
      detail: "Current pipeline status",
      timestamp: document.updatedAt,
    });
  }

  return events.sort((a, b) => {
    if (a.timestamp !== b.timestamp) {
      return a.timestamp < b.timestamp ? 1 : -1;
    }
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });
}
