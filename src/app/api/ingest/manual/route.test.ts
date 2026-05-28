import { describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("workflow/api", () => ({
  start: vi.fn(async () => ({ runId: "run-test" })),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  del: vi.fn(),
}));

describe("POST /api/ingest/manual", () => {
  it("accepts a JSON blob payload and returns a queued batch", async () => {
    const response = await POST(
      new Request("https://example.test/api/ingest/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          folderId: "D9032-F",
          blobs: [
            {
              url: "https://blob.example/D9032-00001.pdf",
              name: "D9032-00001.pdf",
              size: 1234,
              contentType: "application/pdf",
            },
          ],
        }),
      }),
    );
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.batchId).toBe("run-test");
    expect(body.runId).toBe("run-test");
    expect(body.status).toBe("queued");
    expect(body.totalFiles).toBe(1);
    expect(body.perFile).toHaveLength(1);
  });

  it("rejects invalid JSON blob payloads with a 400", async () => {
    const response = await POST(
      new Request("https://example.test/api/ingest/manual", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ blobs: [] }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe("Invalid ingest payload.");
  });
});
