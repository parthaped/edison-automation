import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { GET } from "./[batchId]/route";
import { POST } from "./route";

describe("manual ingest route", () => {
  it("creates a background batch for direct uploads and exposes its status", async () => {
    const formData = new FormData();
    formData.append(
      "files",
      new File([await makePdfBytes()], "D9032-00001.pdf", {
        type: "application/pdf",
      }),
    );
    formData.append("folderId", "D9032-F");

    const response = await POST(
      new Request("https://example.test/api/ingest/manual", {
        method: "POST",
        body: formData,
      }),
    );
    const created = await response.json();

    expect(response.status).toBe(202);
    expect(created.batchId).toMatch(/^manual-/);
    expect(created.status).toBe("queued");

    const completed = await waitForJob(created.batchId);
    expect(completed.status).toBe("completed");
    expect(completed.result.packages[0].documentId).toMatch(/D9032-00001$/);
  });

  it("rejects invalid JSON blob payloads synchronously", async () => {
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

async function waitForJob(batchId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await GET(new Request(`https://example.test/${batchId}`), {
      params: Promise.resolve({ batchId }),
    });
    const body = await response.json();
    if (body.status === "completed" || body.status === "failed") {
      return body;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${batchId}`);
}

async function makePdfBytes(): Promise<ArrayBuffer> {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 200]);
  const bytes = await pdf.save();
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

