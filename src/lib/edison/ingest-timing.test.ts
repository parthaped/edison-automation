import { describe, expect, it } from "vitest";
import { StageTimer } from "./ingest-timing";

describe("StageTimer", () => {
  it("builds segment durations from marks", () => {
    const timer = new StageTimer();
    timer.mark("fetchStart");
    timer.mark("rasterizeStart");
    timer.mark("transcribeStart");
    timer.mark("persistStart");
    timer.mark("persistEnd");

    const timing = timer.build({
      fetchStart: "fetchStart",
      rasterizeStart: "rasterizeStart",
      transcribeStart: "transcribeStart",
      persistStart: "persistStart",
      persistEnd: "persistEnd",
    });

    expect(timing.fetchMs).toBeGreaterThanOrEqual(0);
    expect(timing.rasterizeMs).toBeGreaterThanOrEqual(0);
    expect(timing.transcribeMs).toBeGreaterThanOrEqual(0);
    expect(timing.persistMs).toBeGreaterThanOrEqual(0);
    expect(timing.totalMs).toBeGreaterThanOrEqual(0);
  });
});
