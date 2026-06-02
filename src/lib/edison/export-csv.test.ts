import { describe, expect, it } from "vitest";
import { buildCatalogTitle } from "./metadata-normalize";
import { buildExportCsv, buildExportCsvRow } from "./export-csv";
import { sampleMetadata, sampleTranscription } from "./sample-data";
import type { MetadataExtraction } from "./types";

describe("export csv", () => {
  it("emits Omeka import columns and joins multivalues with |", () => {
    const row = buildExportCsvRow(sampleMetadata, sampleTranscription);

    expect(row["o:id"]).toBe("");
    expect(row["dcterms:identifier"]).toBe("E2002AAA");
    expect(row["dcterms:title"]).toBe(
      buildCatalogTitle(sampleMetadata.documentId, sampleMetadata),
    );
    expect(row["dcterms:type"]).toBe("Letter");
    expect(row["dcterms:date"]).toBe("1890-01-12");
    expect(row["dcterms:creator"]).toBe("Marks, William D.");
    expect(row["bibo:recipient"]).toBe("");
    expect(row["dcterms:relation"]).toBe(
      "Edison Electric Light Co. of Philadelphia",
    );
    expect(row["dcterms:subject"]).toBe("Electric light|station materials");
    expect(row["dcterms:coverage"]).toBe("Philadelphia");
    expect(row["dcterms:isPartOf"]).toBe(
      "[E2002-F] Document File Series -- 1890",
    );
    expect(row["scripto:transcription"]).toBe(sampleTranscription.diplomaticText);
    expect(row["o:media/file"]).toBe(
      "E2002_Page_01.jpg|E2002_Page_02.jpg",
    );
  });

  it("leaves empty multivalue fields blank rather than 'Unknown'", () => {
    const row = buildExportCsvRow(
      { ...sampleMetadata, authors: [], subjects: [], imageNames: [] },
      sampleTranscription,
    );

    expect(row["dcterms:creator"]).toBe("");
    expect(row["dcterms:subject"]).toBe("");
    expect(row["o:media/file"]).toBe("");
  });

  it("escapes CSV cells that contain commas or line breaks", () => {
    const csv = buildExportCsv([
      buildExportCsvRow(sampleMetadata, sampleTranscription),
    ]);

    expect(csv).toContain('"Marks, William D."');
    expect(csv).toContain('"## E2002_Page_01.jpg');
    expect(csv).toContain("Letterhead:");
    expect(csv).toContain("Edison Electric Light Co. of Philadelphia");
  });

  it("emits the canonical Omeka header row followed by data rows with LF terminators", () => {
    const csv = buildExportCsv([
      buildExportCsvRow(sampleMetadata, sampleTranscription),
    ]);
    const lines = csv.split("\n");

    expect(lines[0]).toBe(
      "o:id,dcterms:identifier,dcterms:title,dcterms:type,dcterms:date,dcterms:creator,bibo:recipient,dcterms:relation,dcterms:subject,dcterms:coverage,dcterms:isPartOf,scripto:transcription,o:media/file",
    );
    expect(csv.endsWith("\n")).toBe(false);
    expect(lines.length).toBeGreaterThan(1);
  });

  it("renders a missing field as a blank cell instead of throwing", () => {
    const partialMetadata = {
      ...sampleMetadata,
      title: undefined as unknown as string,
    } satisfies MetadataExtraction;

    expect(() =>
      buildExportCsvRow(partialMetadata, sampleTranscription),
    ).not.toThrow();

    const row = buildExportCsvRow(partialMetadata, sampleTranscription);
    expect(row["dcterms:title"]).toContain("[E2002AAA]");
  });
});
