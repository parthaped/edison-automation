import type { DocumentPackage } from "./types";

export interface FileNavUnit {
  /** `sourceGroup.groupId` or lone `documentId` when ungrouped. */
  key: string;
  documentIds: string[];
  /** First document in queue order for this file (lead sibling). */
  leadDocumentId: string;
}

export function buildFileNavUnits(documents: DocumentPackage[]): FileNavUnit[] {
  const units: FileNavUnit[] = [];
  const groupIndex = new Map<string, number>();

  for (const doc of documents) {
    const groupId = doc.sourceGroup?.groupId;
    if (groupId) {
      const existing = groupIndex.get(groupId);
      if (existing !== undefined) {
        units[existing].documentIds.push(doc.documentId);
      } else {
        groupIndex.set(groupId, units.length);
        units.push({
          key: groupId,
          documentIds: [doc.documentId],
          leadDocumentId: doc.documentId,
        });
      }
    } else {
      units.push({
        key: doc.documentId,
        documentIds: [doc.documentId],
        leadDocumentId: doc.documentId,
      });
    }
  }

  return units;
}

export function fileIndexForDocument(
  units: FileNavUnit[],
  documentId: string,
): number {
  return units.findIndex((unit) => unit.documentIds.includes(documentId));
}

export function leadDocumentIdForFileIndex(
  units: FileNavUnit[],
  fileIndex: number,
): string | undefined {
  return units[fileIndex]?.leadDocumentId;
}
