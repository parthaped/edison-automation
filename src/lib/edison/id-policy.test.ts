import { describe, expect, it } from "vitest";
import {
  appendSubDocumentSuffix,
  assignDocumentId,
  buildDocumentId,
  buildImageFilename,
  defaultFolderIdFromFileName,
  extractDocumentIdFromName,
  findNextAvailablePosition,
  normalizeFolderId,
  positionToAlphabeticSuffix,
} from "./id-policy";

describe("id policy", () => {
  describe("normalizeFolderId", () => {
    it("uppercases and strips non-alphanumeric characters", () => {
      expect(normalizeFolderId(" e2002 ")).toBe("E2002");
      expect(normalizeFolderId("1920-general file")).toBe("1920GENERALFILE");
    });

    it("drops a trailing -F so user-visible folder ids match the TAEP form", () => {
      expect(normalizeFolderId("E2002-F")).toBe("E2002");
      expect(normalizeFolderId("D9032-F")).toBe("D9032");
      expect(normalizeFolderId("D9032_F")).toBe("D9032");
    });

    it("preserves intrinsic trailing F that wasn't an -F suffix", () => {
      // No suffix delimiter, so the F is part of the folder name.
      expect(normalizeFolderId("EAF")).toBe("EAF");
    });
  });

  describe("defaultFolderIdFromFileName", () => {
    it("uppercases the stem and removes the extension", () => {
      expect(defaultFolderIdFromFileName("E2002.pdf")).toBe("E2002");
      expect(defaultFolderIdFromFileName("e2002.PDF")).toBe("E2002");
    });

    it("strips non-alphanumeric characters", () => {
      expect(defaultFolderIdFromFileName("1920-General File.pdf")).toBe(
        "1920GENERALFILE",
      );
    });

    it("falls back to UNASSIGNED when the stem has no usable characters", () => {
      expect(defaultFolderIdFromFileName("___.pdf")).toBe("UNASSIGNED");
    });
  });

  describe("positionToAlphabeticSuffix", () => {
    it("produces 3-letter base-26 suffixes starting at AAA", () => {
      expect(positionToAlphabeticSuffix(0)).toBe("AAA");
      expect(positionToAlphabeticSuffix(1)).toBe("AAB");
      expect(positionToAlphabeticSuffix(25)).toBe("AAZ");
      expect(positionToAlphabeticSuffix(26)).toBe("ABA");
      expect(positionToAlphabeticSuffix(675)).toBe("AZZ");
      expect(positionToAlphabeticSuffix(676)).toBe("BAA");
    });

    it("grows to a 4th letter beyond AZZ * Z (>= 26^3)", () => {
      expect(positionToAlphabeticSuffix(26 ** 3)).toBe("BAAA");
    });

    it("rejects negative or non-integer positions", () => {
      expect(() => positionToAlphabeticSuffix(-1)).toThrow();
      expect(() => positionToAlphabeticSuffix(1.5)).toThrow();
    });
  });

  describe("buildDocumentId", () => {
    it("concatenates folder + alphabetic suffix without a separator", () => {
      expect(buildDocumentId("E2002", 0)).toBe("E2002AAA");
      expect(buildDocumentId("E2002", 5)).toBe("E2002AAF");
      expect(buildDocumentId("1920GENERAL", 0)).toBe("1920GENERALAAA");
    });
  });

  describe("findNextAvailablePosition", () => {
    it("returns 0 when nothing exists", () => {
      expect(findNextAvailablePosition("E2002", new Set())).toBe(0);
    });

    it("skips positions occupied in existingIds", () => {
      const existing = new Set(["E2002AAA", "E2002AAB"]);
      expect(findNextAvailablePosition("E2002", existing)).toBe(2);
    });

    it("honours startFrom so callers can reserve a range", () => {
      const existing = new Set(["E2002AAA"]);
      expect(findNextAvailablePosition("E2002", existing, 3)).toBe(3);
    });
  });

  describe("assignDocumentId", () => {
    it("preserves a supplied document id when free", () => {
      const result = assignDocumentId({
        providedDocumentId: "E2002AAA",
        batchIndex: 1,
        existingIds: new Set(),
      });
      expect(result.documentId).toBe("E2002AAA");
      expect(result.generated).toBe(false);
    });

    it("recovers a TAEP id encoded in the filename", () => {
      const result = assignDocumentId({
        folderId: "E2002",
        sourceName: "E2002AAF1.pdf",
        batchIndex: 1,
        existingIds: new Set(),
      });
      expect(result.documentId).toBe("E2002AAF1");
      expect(result.generated).toBe(false);
    });

    it("defaults the folder to the file name stem", () => {
      const result = assignDocumentId({
        sourceName: "E2002.pdf",
        batchIndex: 1,
        existingIds: new Set(),
      });
      expect(result.documentId).toBe("E2002AAA");
      expect(result.generated).toBe(true);
    });

    it("walks to the next available position within the folder", () => {
      const result = assignDocumentId({
        folderId: "E2002",
        sourceName: "second.pdf",
        batchIndex: 2,
        existingIds: new Set(["E2002AAA", "E2002AAB"]),
      });
      expect(result.documentId).toBe("E2002AAC");
      expect(result.generated).toBe(true);
    });

    it("falls back to a generated id when the supplied one collides", () => {
      const result = assignDocumentId({
        folderId: "E2002",
        providedDocumentId: "E2002AAA",
        sourceName: "duplicate.pdf",
        batchIndex: 1,
        existingIds: new Set(["E2002AAA"]),
      });
      expect(result.documentId).toBe("E2002AAB");
      expect(result.generated).toBe(true);
    });

    it("respects startPosition so the workflow can reserve slots up front", () => {
      const result = assignDocumentId({
        folderId: "E2002",
        sourceName: "third.pdf",
        batchIndex: 3,
        existingIds: new Set(),
        startPosition: 2,
      });
      expect(result.documentId).toBe("E2002AAC");
    });
  });

  describe("appendSubDocumentSuffix", () => {
    it("returns the base id unchanged for position 0", () => {
      expect(appendSubDocumentSuffix("E2002AAF", 0)).toBe("E2002AAF");
    });

    it("appends numeric attachment suffixes matching the TAEP form", () => {
      expect(appendSubDocumentSuffix("E2002AAF", 1)).toBe("E2002AAF1");
      expect(appendSubDocumentSuffix("E2002AAF", 2)).toBe("E2002AAF2");
      expect(appendSubDocumentSuffix("E2002AAF", 10)).toBe("E2002AAF10");
    });

    it("rejects negative or non-integer positions", () => {
      expect(() => appendSubDocumentSuffix("X", -1)).toThrow();
      expect(() => appendSubDocumentSuffix("X", 1.5)).toThrow();
    });
  });

  describe("buildImageFilename", () => {
    it("matches the TAEP <folder>_Page_NN.jpg convention", () => {
      expect(buildImageFilename("E2002", 1)).toBe("E2002_Page_01.jpg");
      expect(buildImageFilename("E2002", 7)).toBe("E2002_Page_07.jpg");
      expect(buildImageFilename("E2002", 85)).toBe("E2002_Page_85.jpg");
    });

    it("expands padding for 100+ page files", () => {
      expect(buildImageFilename("E2002", 100)).toBe("E2002_Page_100.jpg");
    });

    it("rejects non-positive page numbers", () => {
      expect(() => buildImageFilename("E2002", 0)).toThrow();
      expect(() => buildImageFilename("E2002", -1)).toThrow();
    });
  });

  describe("extractDocumentIdFromName", () => {
    it("recognises full TAEP ids", () => {
      expect(extractDocumentIdFromName("E2002AAA.pdf")).toBe("E2002AAA");
      expect(extractDocumentIdFromName("E2002AAF1.pdf")).toBe("E2002AAF1");
    });

    it("recognises legacy dash-numeric ids for back-compat", () => {
      expect(extractDocumentIdFromName("D9032-00001.pdf")).toBe("D9032-00001");
    });

    it("returns undefined when nothing recognisable is present", () => {
      expect(extractDocumentIdFromName("notebook scan.pdf")).toBeUndefined();
    });
  });
});
