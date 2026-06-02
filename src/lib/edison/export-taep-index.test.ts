import { describe, expect, it } from "vitest";
import {
  buildTaepIndexCsv,
  buildTaepIndexRow,
  TAEP_INDEX_COLUMNS,
} from "./export-taep-index";
import type { MetadataExtraction } from "./types";

const e2002AaaMetadata: MetadataExtraction = {
  folderId: "E2002-F",
  documentId: "E2002AAA",
  title: "Traiser to Edison",
  documentType: "Letter",
  date: "1919-12-29",
  authors: ["Traiser, Louis M"],
  recipients: ["Edison, Thomas Alva"],
  mentionedNames: [
    "Electrical Engineering",
    "General Electric Co",
    "University of Wisconsin",
  ],
  subjects: ["Advice"],
  places: [],
  imageNames: ["E2002_Page_01.jpg"],
  confidence: "high",
  comments: "Marginalia by Edison; Attached to E2002AAB",
};

describe("taep index export", () => {
  it("matches TAEP form columns for E2002AAA", () => {
    const exportedAt = "2026-06-02T12:00:00.000Z";
    const row = buildTaepIndexRow(e2002AaaMetadata, exportedAt);

    expect(TAEP_INDEX_COLUMNS).toEqual([
      "Timestamp",
      "GLOC",
      "DocID",
      "Document Type",
      "Date",
      "Author(s)",
      "Recipient(s)",
      "Name(s) Mentioned",
      "Subjects",
      "Places",
      "Image Filename(s)",
      "Comments",
    ]);
    expect(row.Timestamp).toBe(exportedAt);
    expect(row.GLOC).toBe("E2002");
    expect(row.DocID).toBe("E2002AAA");
    expect(row["Document Type"]).toBe("Letter");
    expect(row.Date).toBe("1919-12-29");
    expect(row["Author(s)"]).toBe("Traiser, Louis M");
    expect(row["Recipient(s)"]).toBe("Edison, Thomas Alva");
    expect(row["Name(s) Mentioned"]).toBe(
      "Electrical Engineering; General Electric Co; University of Wisconsin",
    );
    expect(row.Subjects).toBe("Advice");
    expect(row.Places).toBe("");
    expect(row["Image Filename(s)"]).toBe("E2002_Page_01.jpg");
    expect(row.Comments).toBe("Marginalia by Edison; Attached to E2002AAB");
  });

  it("emits semicolon-separated multivalues and LF-terminated CSV", () => {
    const csv = buildTaepIndexCsv([
      buildTaepIndexRow(e2002AaaMetadata, "2026-06-02T12:00:00.000Z"),
    ]);
    const lines = csv.split("\n");

    expect(lines[0]).toBe(TAEP_INDEX_COLUMNS.join(","));
    expect(lines[1]).toContain("E2002AAA");
    expect(lines[1]).toContain(
      "Electrical Engineering; General Electric Co; University of Wisconsin",
    );
    expect(csv.endsWith("\n")).toBe(false);
  });
});
