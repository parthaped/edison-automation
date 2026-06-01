import { describe, expect, it } from "vitest";
import { buildExportCsv, buildExportCsvRow } from "./export-csv";
import { sampleMetadata, sampleTranscription } from "./sample-data";

describe("export csv", () => {
  it("orders columns with Doc ID and Title first and joins multivalues with semicolons", () => {
    const row = buildExportCsvRow(sampleMetadata, sampleTranscription);

    expect(row["Doc ID"]).toBe("D9032-00001");
    expect(row["Folder ID"]).toBe("D9032-F");
    expect(row.Title).toBe(sampleMetadata.title);
    expect(row["Author(s)"]).toBe("Marks, William D.");
    expect(row.Subjects).toBe("Electric light; station materials");
  });

  it("leaves empty multivalue fields blank rather than 'Unknown'", () => {
    const row = buildExportCsvRow(
      { ...sampleMetadata, authors: [], subjects: [] },
      sampleTranscription,
    );

    expect(row["Author(s)"]).toBe("");
    expect(row.Subjects).toBe("");
  });

  it("escapes CSV cells that contain commas or line breaks", () => {
    const csv = buildExportCsv([
      buildExportCsvRow(sampleMetadata, sampleTranscription),
    ]);

    expect(csv).toContain('"Marks, William D."');
    expect(csv).toContain('"Letterhead: Edison Electric Light Co. of Philadelphia');
  });

  it("emits a header row followed by one data row with LF terminators", () => {
    const csv = buildExportCsv([
      buildExportCsvRow(sampleMetadata, sampleTranscription),
    ]);
    const lines = csv.split("\n");

    expect(lines[0]).toBe(
      "Doc ID,Folder ID,Title,Document Type,Date,Author(s),Recipient(s),Name Mentions,Subjects,Image name(s),Confidence,Transcription",
    );
    expect(csv.endsWith("\n")).toBe(false);
    expect(lines.length).toBeGreaterThan(1);
  });
});
