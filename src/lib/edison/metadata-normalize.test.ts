import { describe, expect, it } from "vitest";
import {
  buildCatalogTitle,
  buildIsPartOf,
  formatGloc,
  mapLegacyDocumentType,
  normalizeMetadata,
  normalizeMetadataValue,
} from "./metadata-normalize";
import type { MetadataExtraction } from "./types";

describe("metadata normalization", () => {
  it("treats Unknown and whitespace as blank", () => {
    expect(normalizeMetadataValue("Unknown")).toBe("");
    expect(normalizeMetadataValue("  unknown  ")).toBe("");
    expect(normalizeMetadataValue("  Letter  ")).toBe("Letter");
  });

  it("maps legacy correspondence to Letter", () => {
    expect(mapLegacyDocumentType("correspondence")).toBe("Letter");
    expect(mapLegacyDocumentType("Unknown")).toBe("");
  });

  it("strips -F suffix for GLOC display", () => {
    expect(formatGloc("E2002-F")).toBe("E2002");
    expect(formatGloc("D9032-F")).toBe("D9032");
  });

  it("builds Edison catalog titles for letters", () => {
    const title = buildCatalogTitle("D9245AAG", {
      documentType: "Letter",
      date: "1892-03-28",
      authors: ["Tate, Alfred Ord"],
      recipients: ["Maguire, Thomas, (Edison Employee)"],
      title: "",
    });
    expect(title).toBe(
      "[D9245AAG], Letter from Tate, Alfred Ord to Maguire, Thomas, (Edison Employee), March 28, 1892",
    );
  });

  it("builds isPartOf from folder and date year", () => {
    expect(buildIsPartOf("D9245-F", "1892-03-28")).toBe(
      "[D9245-F] Document File Series -- 1892",
    );
  });

  it("normalizes metadata arrays and strips Unknown values", () => {
    const raw: MetadataExtraction = {
      folderId: "E2002-F",
      documentId: "E2002AAA",
      title: "Unknown",
      documentType: "correspondence",
      date: "Unknown",
      authors: ["Traiser, Louis M"],
      recipients: ["Edison, Thomas Alva"],
      mentionedNames: ["General Electric Co"],
      subjects: ["Advice"],
      places: ["Wisconsin"],
      imageNames: ["E2002_Page_01.jpg"],
      confidence: "medium",
      comments: "  Marginalia by Edison  ",
    };

    const normalized = normalizeMetadata(raw);
    expect(normalized.documentType).toBe("Letter");
    expect(normalized.date).toBe("");
    expect(normalized.places).toEqual(["Wisconsin"]);
    expect(normalized.comments).toBe("Marginalia by Edison");
    expect(normalized.title).toContain("[E2002AAA]");
  });
});
