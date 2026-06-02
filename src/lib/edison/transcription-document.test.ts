import { describe, expect, it } from "vitest";
import {
  findPageIndexByHeading,
  locateUncertainToken,
  parseTranscriptionDocument,
  serializeTranscriptionDocument,
} from "./transcription-document";

const SAMPLE_LETTER = `## D9032-00001/d9032-00001_0001.jpg

Letterhead:
Edison Electric Light Co. of Philadelphia

Dateline:
Philadelphia, Jan. 12, 1890

Salutation:
Dear Sir,

Body:
Mr. Marks reports on the [filament?] tests and station materials.

Signature:
W. D. Marks`;

const SAMPLE_WITH_TABLE = `## page_0001.jpg

Body:
Quarterly totals:

| Item | Amount |
| --- | --- |
| Copper wire | 12.50 |
| Insulation | 4.00 |`;

describe("parseTranscriptionDocument", () => {
  it("parses letter sections and page heading", () => {
    const doc = parseTranscriptionDocument(SAMPLE_LETTER);
    expect(doc.legacy).toBe(false);
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages[0]?.heading).toBe("D9032-00001/d9032-00001_0001.jpg");
    const types = doc.pages[0]?.blocks.map((b) => b.type);
    expect(types).toContain("Letterhead");
    expect(types).toContain("Dateline");
    expect(types).toContain("Body");
  });

  it("parses GFM pipe tables", () => {
    const doc = parseTranscriptionDocument(SAMPLE_WITH_TABLE);
    const tableBlock = doc.pages[0]?.blocks.find((b) => b.type === "table");
    expect(tableBlock?.table?.headers).toEqual(["Item", "Amount"]);
    expect(tableBlock?.table?.rows).toHaveLength(2);
    expect(tableBlock?.table?.rows[0]).toEqual(["Copper wire", "12.50"]);
  });

  it("falls back to legacy prose for unstructured text", () => {
    const doc = parseTranscriptionDocument("Plain paragraph without labels.");
    expect(doc.legacy).toBe(true);
    expect(doc.pages[0]?.blocks).toHaveLength(1);
    expect(doc.pages[0]?.blocks[0]?.type).toBe("prose");
  });

  it("round-trips sample letter", () => {
    const doc = parseTranscriptionDocument(SAMPLE_LETTER);
    const serialized = serializeTranscriptionDocument(doc);
    const reparsed = parseTranscriptionDocument(serialized);
    expect(reparsed.pages[0]?.blocks.length).toBe(doc.pages[0]?.blocks.length);
    expect(serialized).toContain("Letterhead:");
    expect(serialized).toContain("[filament?]");
  });

  it("round-trips table after row change", () => {
    const doc = parseTranscriptionDocument(SAMPLE_WITH_TABLE);
    const table = doc.pages[0]?.blocks.find((b) => b.type === "table");
    if (table?.table) {
      table.table.rows.push(["New item", "1.00"]);
    }
    const serialized = serializeTranscriptionDocument(doc);
    expect(serialized).toContain("| New item | 1.00 |");
    expect(serialized).toContain("| --- |");
  });

  it("locates uncertain token in body", () => {
    const doc = parseTranscriptionDocument(SAMPLE_LETTER);
    const loc = locateUncertainToken(doc, "[filament?]");
    expect(loc).not.toBeNull();
    expect(loc?.blockIndex).toBeGreaterThanOrEqual(0);
  });

  it("finds page index by image filename", () => {
    const doc = parseTranscriptionDocument(SAMPLE_LETTER);
    const idx = findPageIndexByHeading(doc, "D9032-00001/d9032-00001_0001.jpg");
    expect(idx).toBe(0);
  });
});

describe("serializeTranscriptionDocument", () => {
  it("preserves legacy prose as plain text", () => {
    const doc = parseTranscriptionDocument("Only prose here.");
    expect(serializeTranscriptionDocument(doc)).toBe("Only prose here.");
  });
});
