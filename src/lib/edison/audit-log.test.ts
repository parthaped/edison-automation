import { describe, expect, it } from "vitest";
import { InMemoryAuditLog } from "./audit-log";

describe("InMemoryAuditLog", () => {
  it("returns events in descending timestamp order", async () => {
    const log = new InMemoryAuditLog();
    await log.append({
      type: "approved",
      timestamp: "2026-01-01T10:00:00.000Z",
      documentId: "E2002AAA",
    });
    await log.append({
      type: "text_edited",
      timestamp: "2026-01-01T09:00:00.000Z",
      documentId: "E2002AAA",
    });
    await log.append({
      type: "deleted",
      timestamp: "2026-01-01T11:00:00.000Z",
      documentId: "E2002AAA",
    });

    const events = await log.list();
    expect(events.map((event) => event.type)).toEqual([
      "deleted",
      "approved",
      "text_edited",
    ]);
  });

  it("assigns a unique id to every appended event", async () => {
    const log = new InMemoryAuditLog();
    const a = await log.append({
      type: "approved",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const b = await log.append({
      type: "approved",
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    expect(a.id).not.toBe(b.id);
  });

  it("filters by documentId", async () => {
    const log = new InMemoryAuditLog();
    await log.append({
      type: "approved",
      timestamp: "2026-01-01T10:00:00.000Z",
      documentId: "E2002AAA",
    });
    await log.append({
      type: "approved",
      timestamp: "2026-01-01T11:00:00.000Z",
      documentId: "E2002AAB",
    });

    const events = await log.list({ documentId: "E2002AAA" });
    expect(events).toHaveLength(1);
    expect(events[0].documentId).toBe("E2002AAA");
  });

  it("filters by event type", async () => {
    const log = new InMemoryAuditLog();
    await log.append({
      type: "approved",
      timestamp: "2026-01-01T10:00:00.000Z",
      documentId: "E2002AAA",
    });
    await log.append({
      type: "deleted",
      timestamp: "2026-01-01T11:00:00.000Z",
      documentId: "E2002AAA",
    });
    await log.append({
      type: "text_edited",
      timestamp: "2026-01-01T12:00:00.000Z",
      documentId: "E2002AAA",
    });

    const events = await log.list({ types: ["approved", "deleted"] });
    expect(events.map((event) => event.type).sort()).toEqual([
      "approved",
      "deleted",
    ]);
  });

  it("respects the limit option", async () => {
    const log = new InMemoryAuditLog();
    for (let i = 0; i < 5; i += 1) {
      await log.append({
        type: "approved",
        timestamp: `2026-01-01T1${i}:00:00.000Z`,
      });
    }
    const events = await log.list({ limit: 2 });
    expect(events).toHaveLength(2);
    expect(events[0].timestamp).toBe("2026-01-01T14:00:00.000Z");
  });

  it("filters by `before` timestamp (exclusive)", async () => {
    const log = new InMemoryAuditLog();
    await log.append({
      type: "approved",
      timestamp: "2026-01-01T10:00:00.000Z",
    });
    await log.append({
      type: "approved",
      timestamp: "2026-01-01T11:00:00.000Z",
    });
    await log.append({
      type: "approved",
      timestamp: "2026-01-01T12:00:00.000Z",
    });

    const events = await log.list({ before: "2026-01-01T12:00:00.000Z" });
    expect(events.map((event) => event.timestamp)).toEqual([
      "2026-01-01T11:00:00.000Z",
      "2026-01-01T10:00:00.000Z",
    ]);
  });
});
