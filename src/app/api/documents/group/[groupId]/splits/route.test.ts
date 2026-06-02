import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { InMemoryEdisonRepository } from "@/lib/edison/in-memory-repository";
import {
  EdisonAutomationService,
  processSourceFileSubDocuments,
} from "@/lib/edison/service";

// One mocked service-factory module shared across every test in this file.
// We avoid `vi.resetModules` here because resetting clears the AppError
// class identity, which breaks `instanceof AppError` checks inside the
// route's error handler and produces 500 instead of 400. Instead, the mock
// returns whatever `currentService` points at, and `beforeEach` swaps that
// pointer to a freshly seeded repository per test.
let currentService: EdisonAutomationService | undefined;

vi.mock("@/lib/edison/service-factory", () => ({
  getEdisonService: () => {
    if (!currentService) {
      throw new Error("Test forgot to initialize currentService.");
    }
    return currentService;
  },
}));

async function makePdf(pages: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) pdf.addPage([100, 100]);
  return pdf.save();
}

async function buildSeededService(): Promise<EdisonAutomationService> {
  const repository = new InMemoryEdisonRepository(false);
  const bytes = await makePdf(6);
  const initial = await processSourceFileSubDocuments({
    sourceFile: {
      id: "src-test",
      name: "group.pdf",
      size: bytes.byteLength,
      mimeType: "application/pdf",
    },
    bytes,
    folderId: "E2002",
    batchIndex: 1,
    existingIds: new Set(),
    providedDocumentId: "E2002AAZ",
    subDocuments: [
      {
        startPage: 1,
        endPage: 3,
        ocrText: "A",
        uncertainReadings: [],
        metadata: {
          title: "First",
          documentType: "correspondence",
          date: "1890",
          authors: [],
          recipients: [],
          mentionedNames: [],
          subjects: [],
          places: [],
        },
      },
      {
        startPage: 4,
        endPage: 6,
        ocrText: "B",
        uncertainReadings: [],
        metadata: {
          title: "Second",
          documentType: "correspondence",
          date: "1891",
          authors: [],
          recipients: [],
          mentionedNames: [],
          subjects: [],
          places: [],
        },
      },
    ],
  });
  for (const sibling of initial.siblings) {
    await repository.saveProcessedDocument(
      sibling.documentPackage,
      sibling.transcription,
      sibling.metadata,
    );
  }
  return new EdisonAutomationService(repository);
}

describe("/api/documents/group/[groupId]/splits", () => {
  beforeEach(async () => {
    currentService = await buildSeededService();
  });

  it("rebuilds siblings on a valid splits payload", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.test/api/documents/group/E2002AAZ/splits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          splits: [{ startPage: 1, endPage: 6, title: "Merged" }],
        }),
      }),
      { params: Promise.resolve({ groupId: "E2002AAZ" }) },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      siblings: Array<{ documentId: string; startPage: number; endPage: number }>;
    };
    expect(body.siblings).toHaveLength(1);
    expect(body.siblings[0]).toMatchObject({
      documentId: "E2002AAZ",
      startPage: 1,
      endPage: 6,
    });
  });

  it("rejects gaps with a 400", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.test/api/documents/group/E2002AAZ/splits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          splits: [
            { startPage: 1, endPage: 2 },
            { startPage: 4, endPage: 6 },
          ],
        }),
      }),
      { params: Promise.resolve({ groupId: "E2002AAZ" }) },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/must start at page 3/);
  });

  it("rejects malformed payloads with a 400", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      new Request("https://example.test/api/documents/group/E2002AAZ/splits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ splits: [{ startPage: "x" }] }),
      }),
      { params: Promise.resolve({ groupId: "E2002AAZ" }) },
    );

    expect(response.status).toBe(400);
  });

  it("returns current siblings on GET", async () => {
    const { GET } = await import("./route");
    const response = await GET(
      new Request(
        "https://example.test/api/documents/group/E2002AAZ/splits",
      ),
      { params: Promise.resolve({ groupId: "E2002AAZ" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      siblings: Array<{ documentId: string; startPage: number; endPage: number }>;
      totalPages: number;
    };
    expect(body.totalPages).toBe(6);
    expect(body.siblings).toHaveLength(2);
    expect(body.siblings[0]).toMatchObject({
      documentId: "E2002AAZ",
      startPage: 1,
      endPage: 3,
    });
    expect(body.siblings[1]).toMatchObject({
      documentId: "E2002AAZ1",
      startPage: 4,
      endPage: 6,
    });
  });
});
