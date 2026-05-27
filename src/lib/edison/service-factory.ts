import { InMemoryEdisonRepository } from "./in-memory-repository";
import { EdisonAutomationService } from "./service";

const globalForEdison = globalThis as unknown as {
  edisonRepository?: InMemoryEdisonRepository;
  edisonService?: EdisonAutomationService;
};

export function getEdisonService(): EdisonAutomationService {
  if (!globalForEdison.edisonRepository) {
    globalForEdison.edisonRepository = new InMemoryEdisonRepository(true);
  }

  if (!globalForEdison.edisonService) {
    globalForEdison.edisonService = new EdisonAutomationService(
      globalForEdison.edisonRepository,
    );
  }

  return globalForEdison.edisonService;
}
