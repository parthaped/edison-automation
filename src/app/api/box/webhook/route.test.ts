import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("Box webhook route", () => {
  it("records FILE.UPLOADED events without starting transcription", async () => {
    const request = new Request("https://example.test/api/box/webhook", {
      method: "POST",
      body: JSON.stringify({
        id: "event-1",
        trigger: "FILE.UPLOADED",
        source: {
          id: "file-1",
          type: "file",
          name: "D9032-00001.pdf",
          size: 100,
          sha1: "abc",
          parent: { id: "folder-1", name: "D9032-F" },
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recorded).toBe(true);
    expect(body.queued).toBe(false);
    expect(body.upload.boxFileId).toBe("file-1");
    expect(body.upload.folderName).toBe("D9032-F");
  });

  it("ignores non-upload events", async () => {
    const request = new Request("https://example.test/api/box/webhook", {
      method: "POST",
      body: JSON.stringify({
        id: "event-1",
        trigger: "FILE.DELETED",
        source: { id: "file-1", type: "file" },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.recorded).toBe(false);
    expect(body.queued).toBe(false);
  });
});
