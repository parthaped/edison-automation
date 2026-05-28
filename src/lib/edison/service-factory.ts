import { BlobEdisonRepository } from "./blob-repository";
import { InMemoryEdisonRepository } from "./in-memory-repository";
import type { EdisonRepository } from "./repositories";
import { EdisonAutomationService } from "./service";

const globalForEdison = globalThis as unknown as {
  edisonRepository?: EdisonRepository;
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

export function getEdisonService(): EdisonAutomationService {
  if (!globalForEdison.edisonRepository) {
    globalForEdison.edisonRepository = createRepository();
  }

  if (!globalForEdison.edisonService) {
    globalForEdison.edisonService = new EdisonAutomationService(
      globalForEdison.edisonRepository,
    );
  }

  return globalForEdison.edisonService;
}
