import { describe, expect, it } from "vitest";
import { buildOmekaCsv, buildOmekaCsvRow } from "./omeka-export";
import { sampleMetadata, sampleTranscription } from "./sample-data";

describe("omeka export", () => {
  it("formats semicolon-separated metadata columns", () => {
    const row = buildOmekaCsvRow(sampleMetadata, sampleTranscription);

    expect(row["Folder ID"]).toBe("D9032-F");
    expect(row["Author(s)"]).toBe("Marks, William D.");
    expect(row.Subjects).toBe("Electric light; station materials");
  });

  it("escapes CSV cells that contain commas or line breaks", () => {
    const csv = buildOmekaCsv([buildOmekaCsvRow(sampleMetadata, sampleTranscription)]);

    expect(csv).toContain('"Marks, William D."');
    expect(csv).toContain('"Letterhead: Edison Electric Light Co. of Philadelphia');
  });

  it("emits CRLF line terminators for Excel and Omeka compatibility", () => {
    const csv = buildOmekaCsv([buildOmekaCsvRow(sampleMetadata, sampleTranscription)]);

    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n").length).toBeGreaterThan(1);
  });
});
