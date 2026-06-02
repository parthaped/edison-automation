import { describe, expect, it } from "vitest";
import {
  appendSubDocumentSuffix,
  assignDocumentId,
  buildImageFilename,
  extractDocumentIdFromName,
  normalizeFolderId,
} from "./id-policy";

describe("id policy", () => {
  it("normalizes folder IDs", () => {
    expect(normalizeFolderId(" d9032 ")).toBe("D9032-F");
    expect(normalizeFolderId("D9032-F")).toBe("D9032-F");
  });

  it("extracts document IDs from filenames", () => {
    expect(extractDocumentIdFromName("D9032-00001.pdf")).toBe("D9032-00001");
  });

  it("preserves supplied document IDs when they do not collide", () => {
    const result = assignDocumentId({
      providedDocumentId: "A200084",
      batchIndex: 1,
      existingIds: new Set(),
    });

    expect(result.documentId).toBe("A200084");
    expect(result.generated).toBe(false);
  });

  it("generates collision-free IDs when supplied IDs already exist", () => {
    const existingIds = new Set(["A200084", "NEW-D9032-00001"]);
    const result = assignDocumentId({
      folderId: "D9032-F",
      providedDocumentId: "A200084",
      batchIndex: 1,
      existingIds,
    });

    expect(result.documentId).toBe("NEW-D9032-00001-1");
    expect(result.generated).toBe(true);
  });

  it("creates deterministic image filenames", () => {
    expect(buildImageFilename("D9032-00001", "Marked Letter.pdf", 2)).toBe(
      "D9032-00001/marked-letter_0003.jpg",
    );
  });

  describe("appendSubDocumentSuffix", () => {
    it("returns the base id unchanged for position 0", () => {
      expect(appendSubDocumentSuffix("D9032-00001", 0)).toBe("D9032-00001");
    });

    it("appends A..Z for positions 1..26", () => {
      expect(appendSubDocumentSuffix("D9032-00001", 1)).toBe("D9032-00001-A");
      expect(appendSubDocumentSuffix("D9032-00001", 2)).toBe("D9032-00001-B");
      expect(appendSubDocumentSuffix("D9032-00001", 26)).toBe("D9032-00001-Z");
    });

    it("rolls over to AA after Z", () => {
      expect(appendSubDocumentSuffix("D9032-00001", 27)).toBe("D9032-00001-AA");
      expect(appendSubDocumentSuffix("D9032-00001", 28)).toBe("D9032-00001-AB");
      expect(appendSubDocumentSuffix("D9032-00001", 52)).toBe("D9032-00001-AZ");
      expect(appendSubDocumentSuffix("D9032-00001", 53)).toBe("D9032-00001-BA");
    });

    it("rejects negative or non-integer positions", () => {
      expect(() => appendSubDocumentSuffix("X", -1)).toThrow();
      expect(() => appendSubDocumentSuffix("X", 1.5)).toThrow();
    });
  });
});
