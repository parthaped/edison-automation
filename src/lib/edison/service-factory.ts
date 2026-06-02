import {
  BlobAuditLog,
  InMemoryAuditLog,
  type AuditLog,
} from "./audit-log";
import { BlobEdisonRepository } from "./blob-repository";
import { InMemoryEdisonRepository } from "./in-memory-repository";
import type { EdisonRepository } from "./repositories";
import { EdisonAutomationService } from "./service";

const globalForEdison = globalThis as unknown as {
  edisonRepository?: EdisonRepository;
  edisonAuditLog?: AuditLog;
  edisonService?: EdisonAutomationService;
};

function createRepository(): EdisonRepository {
  // Durable Blob-backed store whenever a Blob token is configured (production
  // and previews). Otherwise fall back to the seeded in-memory store for local
  // development and tests.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return new BlobEdisonRepository();
  }
  const seed = process.env.NODE_ENV !== "production";
  return new InMemoryEdisonRepository(seed);
}

function createAuditLog(): AuditLog {
  // Real append-only event log when Blob is available; otherwise the same
  // global in-memory log so audit events survive across requests inside a
  // single dev process.
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return new BlobAuditLog();
  }
  return new InMemoryAuditLog();
}

export function getEdisonService(): EdisonAutomationService {
  if (!globalForEdison.edisonRepository) {
    globalForEdison.edisonRepository = createRepository();
  }
  if (!globalForEdison.edisonAuditLog) {
    globalForEdison.edisonAuditLog = createAuditLog();
  }

  if (!globalForEdison.edisonService) {
    globalForEdison.edisonService = new EdisonAutomationService(
      globalForEdison.edisonRepository,
      globalForEdison.edisonAuditLog,
    );
  }

  return globalForEdison.edisonService;
}
