import { describe, expect, it } from "vitest";
import { buildOmekaApiPayload, buildOmekaCsv, buildOmekaCsvRow } from "./omeka-export";
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

  it("builds Omeka API payload fields", () => {
    const payload = buildOmekaApiPayload(sampleMetadata, sampleTranscription);

    expect(payload["dcterms:identifier"][0]["@value"]).toBe("D9032-00001");
    expect(payload["dcterms:isPartOf"][0]["@value"]).toBe("D9032-F");
  });
});
