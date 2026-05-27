import { describe, expect, it } from "vitest";
import { POST } from "./route";

describe("Box webhook route", () => {
  it("queues FILE.UPLOADED events", async () => {
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
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.queued).toBe(true);
    expect(body.job.boxFileId).toBe("file-1");
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
    expect(body.queued).toBe(false);
  });
});
