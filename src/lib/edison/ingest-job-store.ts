import { createClient, type VercelKV } from "@vercel/kv";
import type { ManualIngestResult } from "./service";

export type FileStage =
  | "queued"
  | "uploaded"
  | "fetching"
  | "transcribing"
  | "indexing"
  | "saving"
  | "done"
  | "failed";

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed";

export interface FileSnapshot {
  fileName: string;
  size?: number;
  stage: FileStage;
  startedAt?: string;
  finishedAt?: string;
  documentId?: string;
  errorMessage?: string;
}

export interface IngestJobSnapshot {
  batchId: string;
  status: JobStatus;
  folderId?: string;
  totalFiles: number;
  completedFiles: number;
  failedFiles: number;
  createdAt: string;
  updatedAt: string;
  perFile: FileSnapshot[];
  result?: ManualIngestResult;
  error?: string;
  runId?: string;
}

const KEY_PREFIX = "edison:ingest:";
const SNAPSHOT_TTL_SECONDS = 60 * 60 * 24; // 24 hours

interface IngestJobStore {
  read(batchId: string): Promise<IngestJobSnapshot | null>;
  write(snapshot: IngestJobSnapshot): Promise<void>;
  patch(
    batchId: string,
    update: (
      current: IngestJobSnapshot,
    ) => IngestJobSnapshot | Promise<IngestJobSnapshot>,
  ): Promise<IngestJobSnapshot>;
}

class InMemoryIngestJobStore implements IngestJobStore {
  private readonly snapshots: Map<string, IngestJobSnapshot>;
  // Per-batch async mutex so concurrent patches do not race when running on a
  // single warm instance (e.g. local dev / hobby).
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(store: Map<string, IngestJobSnapshot>) {
    this.snapshots = store;
  }

  async read(batchId: string): Promise<IngestJobSnapshot | null> {
    return this.snapshots.get(batchId) ?? null;
  }

  async write(snapshot: IngestJobSnapshot): Promise<void> {
    this.snapshots.set(snapshot.batchId, snapshot);
  }

  async patch(
    batchId: string,
    update: (
      current: IngestJobSnapshot,
    ) => IngestJobSnapshot | Promise<IngestJobSnapshot>,
  ): Promise<IngestJobSnapshot> {
    const previous = this.locks.get(batchId) ?? Promise.resolve();
    const next = previous.then(async () => {
      const current = this.snapshots.get(batchId);
      if (!current) {
        throw new Error(`Ingest job ${batchId} not found.`);
      }
      const updated = await update(current);
      const merged: IngestJobSnapshot = {
        ...updated,
        updatedAt: new Date().toISOString(),
      };
      this.snapshots.set(batchId, merged);
      return merged;
    });
    this.locks.set(batchId, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(batchId) === next) {
        this.locks.delete(batchId);
      }
    }
  }
}

class KvIngestJobStore implements IngestJobStore {
  constructor(private readonly client: VercelKV) {}

  async read(batchId: string): Promise<IngestJobSnapshot | null> {
    return this.client.get<IngestJobSnapshot>(`${KEY_PREFIX}${batchId}`);
  }

  async write(snapshot: IngestJobSnapshot): Promise<void> {
    await this.client.set(`${KEY_PREFIX}${snapshot.batchId}`, snapshot, {
      ex: SNAPSHOT_TTL_SECONDS,
    });
  }

  async patch(
    batchId: string,
    update: (
      current: IngestJobSnapshot,
    ) => IngestJobSnapshot | Promise<IngestJobSnapshot>,
  ): Promise<IngestJobSnapshot> {
    // Optimistic update with a short retry budget; KV is single-region serial
    // for a given key but we may race with parallel step writes.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.client.get<IngestJobSnapshot>(
        `${KEY_PREFIX}${batchId}`,
      );
      if (!current) {
        throw new Error(`Ingest job ${batchId} not found.`);
      }
      const updated = await update(current);
      const merged: IngestJobSnapshot = {
        ...updated,
        updatedAt: new Date().toISOString(),
      };
      await this.client.set(`${KEY_PREFIX}${batchId}`, merged, {
        ex: SNAPSHOT_TTL_SECONDS,
      });
      return merged;
    }
    throw new Error(
      `Failed to patch ingest job ${batchId} after 5 attempts.`,
    );
  }
}

const globalForStore = globalThis as unknown as {
  edisonIngestStore?: Map<string, IngestJobSnapshot>;
  edisonIngestStoreImpl?: IngestJobStore;
};
globalForStore.edisonIngestStore ??= new Map<string, IngestJobSnapshot>();

function createStore(): IngestJobStore {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const client = createClient({ url, token });
    return new KvIngestJobStore(client);
  }
  return new InMemoryIngestJobStore(globalForStore.edisonIngestStore!);
}

export function getIngestJobStore(): IngestJobStore {
  globalForStore.edisonIngestStoreImpl ??= createStore();
  return globalForStore.edisonIngestStoreImpl;
}

export function newPerFile(
  files: Array<{ name: string; size?: number }>,
): FileSnapshot[] {
  return files.map((file) => ({
    fileName: file.name,
    size: file.size,
    stage: "queued",
  }));
}

export function setFileStage(
  perFile: FileSnapshot[],
  fileName: string,
  partial: Partial<FileSnapshot>,
): FileSnapshot[] {
  return perFile.map((entry) =>
    entry.fileName === fileName ? { ...entry, ...partial } : entry,
  );
}
