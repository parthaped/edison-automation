/**
 * Append-only event log for everything that happens to a document. Replaces
 * the snapshot-derived `buildAuditTrail` so the audit page can show a real
 * history (edits, unapprovals, splits, folder renames, etc.) instead of
 * reconstructing events from each record's `updatedAt`.
 *
 * Two implementations:
 *  - `InMemoryAuditLog` – an in-process array, used by tests and the
 *    default factory when no Blob store is configured.
 *  - `BlobAuditLog`     – one Vercel Blob JSON file per event, indexed by
 *    pathname so list-and-slice paginated reads stay sortable.
 */

import type { ConfidenceBucket, ProcessingStatus } from "./types";

export type AuditEventType =
  | "ingest_started"
  | "file_ingested"
  | "file_transcribed"
  | "file_graded"
  | "text_edited"
  | "comments_edited"
  | "approved"
  | "unapproved"
  | "splits_changed"
  | "folder_renamed"
  | "deleted";

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  timestamp: string;
  documentId?: string;
  folderId?: string;
  title?: string;
  detail?: string;
  confidence?: ConfidenceBucket;
  status?: ProcessingStatus;
  metadata?: Record<string, unknown>;
}

export interface AuditLogListOptions {
  limit?: number;
  before?: string;
  documentId?: string;
  types?: AuditEventType[];
}

export interface AuditLog {
  append(event: Omit<AuditEvent, "id">): Promise<AuditEvent>;
  list(opts?: AuditLogListOptions): Promise<AuditEvent[]>;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function matchesFilter(event: AuditEvent, opts: AuditLogListOptions): boolean {
  if (opts.documentId && event.documentId !== opts.documentId) return false;
  if (opts.types && opts.types.length > 0 && !opts.types.includes(event.type)) {
    return false;
  }
  if (opts.before && event.timestamp >= opts.before) return false;
  return true;
}

export class InMemoryAuditLog implements AuditLog {
  private readonly events: AuditEvent[] = [];

  async append(event: Omit<AuditEvent, "id">): Promise<AuditEvent> {
    const stored: AuditEvent = {
      ...event,
      id: `${event.timestamp}-${randomId()}`,
    };
    this.events.push(stored);
    return stored;
  }

  async list(opts: AuditLogListOptions = {}): Promise<AuditEvent[]> {
    const sorted = [...this.events].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0,
    );
    const filtered = sorted.filter((event) => matchesFilter(event, opts));
    return opts.limit ? filtered.slice(0, opts.limit) : filtered;
  }
}

const EVENT_PREFIX = "audit-events/";

function eventPath(event: AuditEvent): string {
  // Inverted timestamp keeps newest events at the top of a lexical sort,
  // so `list({ prefix })` returns them descending without a body fetch.
  const invertedTimestamp = invertIsoTimestamp(event.timestamp);
  return `${EVENT_PREFIX}${invertedTimestamp}-${event.id}.json`;
}

function invertIsoTimestamp(iso: string): string {
  // For a Date d, write a string that sorts in reverse chronological order.
  // We use Number.MAX_SAFE_INTEGER - epoch ms, zero-padded.
  const ms = new Date(iso).getTime();
  const inverted = Number.MAX_SAFE_INTEGER - (Number.isFinite(ms) ? ms : 0);
  return inverted.toString().padStart(16, "0");
}

export class BlobAuditLog implements AuditLog {
  async append(event: Omit<AuditEvent, "id">): Promise<AuditEvent> {
    const { put } = await import("@vercel/blob");
    const stored: AuditEvent = {
      ...event,
      id: `${event.timestamp}-${randomId()}`,
    };
    await put(eventPath(stored), JSON.stringify(stored), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: false,
      cacheControlMaxAge: 0,
    });
    return stored;
  }

  async list(opts: AuditLogListOptions = {}): Promise<AuditEvent[]> {
    const { list } = await import("@vercel/blob");
    // Blob list is lexically sorted, so the inverted-timestamp pathnames put
    // the newest events first. We accumulate until we have enough matching
    // events or run out of blobs.
    const limit = opts.limit ?? 200;
    const collected: AuditEvent[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix: EVENT_PREFIX,
        limit: 1000,
        cursor,
      });
      const fetched = await Promise.all(
        page.blobs.map(async (blob) => {
          try {
            const response = await fetch(blob.url, { cache: "no-store" });
            if (!response.ok) return null;
            return (await response.json()) as AuditEvent;
          } catch {
            return null;
          }
        }),
      );
      for (const event of fetched) {
        if (event && matchesFilter(event, opts)) {
          collected.push(event);
          if (collected.length >= limit) break;
        }
      }
      if (collected.length >= limit) break;
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return collected
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, limit);
  }
}
