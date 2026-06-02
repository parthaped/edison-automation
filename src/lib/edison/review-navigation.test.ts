import { describe, expect, it } from "vitest";
import {
  buildFileNavUnits,
  fileIndexForDocument,
  leadDocumentIdForFileIndex,
} from "./review-navigation";
import type { DocumentPackage, SourceGroup } from "./types";

function makeDoc(
  documentId: string,
  sourceGroup?: SourceGroup,
): DocumentPackage {
  return {
    id: documentId,
    folderId: "F1",
    documentId,
    title: `Title ${documentId}`,
    sourceFile: {
      id: `file-${documentId}`,
      name: `${documentId}.pdf`,
      size: 1000,
      mimeType: "application/pdf",
    },
    pages: [],
    status: "needs_review",
    confidence: "medium",
    validationWarnings: [],
    uncertaintyNotes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceGroup,
  };
}

const multiSiblingGroup: SourceGroup = {
  groupId: "GROUP-A",
  originalFileName: "batch.pdf",
  position: 0,
  siblingIds: ["DOC-A", "DOC-A-1", "DOC-A-2"],
  totalPages: 6,
};

describe("buildFileNavUnits", () => {
  it("groups siblings into one unit and keeps ungrouped docs separate", () => {
    const documents = [
      makeDoc("DOC-A", { ...multiSiblingGroup, position: 0 }),
      makeDoc("DOC-A-1", { ...multiSiblingGroup, position: 1 }),
      makeDoc("DOC-A-2", { ...multiSiblingGroup, position: 2 }),
      makeDoc("DOC-B"),
    ];

    const units = buildFileNavUnits(documents);

    expect(units).toHaveLength(2);
    expect(units[0]).toEqual({
      key: "GROUP-A",
      documentIds: ["DOC-A", "DOC-A-1", "DOC-A-2"],
      leadDocumentId: "DOC-A",
    });
    expect(units[1]).toEqual({
      key: "DOC-B",
      documentIds: ["DOC-B"],
      leadDocumentId: "DOC-B",
    });
  });

  it("preserves queue order for the first encounter of each file", () => {
    const documents = [makeDoc("DOC-B"), makeDoc("DOC-A", multiSiblingGroup)];

    const units = buildFileNavUnits(documents);

    expect(units.map((u) => u.leadDocumentId)).toEqual(["DOC-B", "DOC-A"]);
  });
});

describe("fileIndexForDocument", () => {
  it("returns the file index for any sibling in the group", () => {
    const documents = [
      makeDoc("DOC-A", { ...multiSiblingGroup, position: 0 }),
      makeDoc("DOC-A-1", { ...multiSiblingGroup, position: 1 }),
      makeDoc("DOC-B"),
    ];
    const units = buildFileNavUnits(documents);

    expect(fileIndexForDocument(units, "DOC-A-1")).toBe(0);
    expect(fileIndexForDocument(units, "DOC-B")).toBe(1);
    expect(fileIndexForDocument(units, "missing")).toBe(-1);
  });
});

describe("leadDocumentIdForFileIndex", () => {
  it("returns the lead document for a valid file index", () => {
    const units = buildFileNavUnits([
      makeDoc("DOC-A", multiSiblingGroup),
      makeDoc("DOC-B"),
    ]);

    expect(leadDocumentIdForFileIndex(units, 1)).toBe("DOC-B");
    expect(leadDocumentIdForFileIndex(units, 99)).toBeUndefined();
  });
});
