/**
 * Edison Markdown v1 — parse/serialize for layout-aware transcription editing.
 * Canonical storage remains a single diplomaticText string.
 */

export const SECTION_LABELS = [
  "Letterhead",
  "Dateline",
  "To",
  "From",
  "Salutation",
  "Body",
  "Closing",
  "Signature",
  "Annotations",
] as const;

export type SectionLabel = (typeof SECTION_LABELS)[number];

export type BlockType = SectionLabel | "prose" | "table" | "heading";

export interface TranscriptionTable {
  headers: string[];
  rows: string[][];
}

export interface TranscriptionBlock {
  type: BlockType;
  /** Section label for letter blocks; page heading text for heading blocks. */
  label?: string;
  content: string;
  table?: TranscriptionTable;
}

export interface TranscriptionPage {
  heading: string | null;
  blocks: TranscriptionBlock[];
}

export interface TranscriptionDocument {
  pages: TranscriptionPage[];
  /** True when the source had no recognizable structure. */
  legacy: boolean;
}

const SECTION_LABEL_PATTERN = new RegExp(
  `^(${SECTION_LABELS.join("|")}):\\s*$`,
  "im",
);

const PAGE_HEADING_PATTERN = /^##\s+(.+)$/m;

function normalizeSectionLabel(label: string): SectionLabel {
  const match = SECTION_LABELS.find(
    (candidate) => candidate.toLowerCase() === label.toLowerCase(),
  );
  return match ?? "Body";
}

function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) return false;
  const cells = trimmed
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseTableRow(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.startsWith("|") ? trimmed.slice(1) : trimmed;
  const withoutEnd = inner.endsWith("|") ? inner.slice(0, -1) : inner;
  return withoutEnd.split("|").map((cell) => cell.trim());
}

function tryParseTable(lines: string[], startIndex: number): {
  table: TranscriptionTable;
  consumed: number;
} | null {
  if (startIndex >= lines.length) return null;
  const headerLine = lines[startIndex]?.trim() ?? "";
  if (!headerLine.startsWith("|")) return null;
  if (startIndex + 1 >= lines.length) return null;
  if (!isTableSeparatorLine(lines[startIndex + 1] ?? "")) return null;

  const headers = parseTableRow(headerLine);
  const rows: string[][] = [];
  let index = startIndex + 2;
  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";
    if (!line.startsWith("|")) break;
    rows.push(parseTableRow(line));
    index += 1;
  }
  return { table: { headers, rows }, consumed: index - startIndex };
}

function hasStructuredMarkers(text: string): boolean {
  if (PAGE_HEADING_PATTERN.test(text)) return true;
  if (SECTION_LABEL_PATTERN.test(text)) return true;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (tryParseTable(lines, i)) return true;
  }
  return false;
}

function parseBlocksFromLines(lines: string[]): TranscriptionBlock[] {
  const blocks: TranscriptionBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (!trimmed) {
      index += 1;
      continue;
    }

    const sectionMatch = trimmed.match(SECTION_LABEL_PATTERN);
    if (sectionMatch) {
      const label = normalizeSectionLabel(sectionMatch[1] ?? "Body");
      index += 1;
      const contentLines: string[] = [];
      while (index < lines.length) {
        const next = lines[index] ?? "";
        const nextTrimmed = next.trim();
        if (SECTION_LABEL_PATTERN.test(nextTrimmed)) break;
        if (PAGE_HEADING_PATTERN.test(nextTrimmed)) break;
        if (tryParseTable(lines, index)) break;
        contentLines.push(next);
        index += 1;
      }
      blocks.push({
        type: label,
        label,
        content: contentLines.join("\n").trimEnd(),
      });
      continue;
    }

    const tableParse = tryParseTable(lines, index);
    if (tableParse) {
      blocks.push({
        type: "table",
        content: "",
        table: tableParse.table,
      });
      index += tableParse.consumed;
      continue;
    }

    const proseLines: string[] = [line];
    index += 1;
    while (index < lines.length) {
      const next = lines[index] ?? "";
      const nextTrimmed = next.trim();
      if (!nextTrimmed) {
        proseLines.push(next);
        index += 1;
        continue;
      }
      if (SECTION_LABEL_PATTERN.test(nextTrimmed)) break;
      if (PAGE_HEADING_PATTERN.test(nextTrimmed)) break;
      if (tryParseTable(lines, index)) break;
      proseLines.push(next);
      index += 1;
    }
    blocks.push({
      type: "prose",
      content: proseLines.join("\n").trimEnd(),
    });
  }

  return blocks;
}

export function parseTranscriptionDocument(text: string): TranscriptionDocument {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.trim()) {
    return { pages: [{ heading: null, blocks: [] }], legacy: true };
  }

  if (!hasStructuredMarkers(normalized)) {
    return {
      pages: [
        {
          heading: null,
          blocks: [{ type: "prose", content: normalized.trimEnd() }],
        },
      ],
      legacy: true,
    };
  }

  const lines = normalized.split("\n");
  const pages: TranscriptionPage[] = [];
  let currentHeading: string | null = null;
  let segmentStart = 0;

  function flushSegment(end: number) {
    const segmentLines = lines.slice(segmentStart, end);
    const blocks = parseBlocksFromLines(segmentLines);
    if (blocks.length > 0 || currentHeading !== null) {
      pages.push({ heading: currentHeading, blocks });
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const trimmed = (lines[i] ?? "").trim();
    const headingMatch = trimmed.match(PAGE_HEADING_PATTERN);
    if (headingMatch) {
      flushSegment(i);
      currentHeading = (headingMatch[1] ?? "").trim();
      segmentStart = i + 1;
    }
  }
  flushSegment(lines.length);

  if (pages.length === 0) {
    return {
      pages: [
        {
          heading: null,
          blocks: parseBlocksFromLines(lines),
        },
      ],
      legacy: false,
    };
  }

  return { pages, legacy: false };
}

function serializeTable(table: TranscriptionTable): string {
  const escapeCell = (cell: string) => cell.replace(/\|/g, "\\|");
  const headerRow = `| ${table.headers.map(escapeCell).join(" | ")} |`;
  const separator = `| ${table.headers.map(() => "---").join(" | ")} |`;
  const bodyRows = table.rows.map(
    (row) =>
      `| ${table.headers
        .map((_, colIndex) => escapeCell(row[colIndex] ?? ""))
        .join(" | ")} |`,
  );
  return [headerRow, separator, ...bodyRows].join("\n");
}

function serializeBlock(block: TranscriptionBlock): string {
  if (block.type === "table" && block.table) {
    return serializeTable(block.table);
  }
  if (block.type === "prose") {
    return block.content;
  }
  if (block.type === "heading") {
    return block.content ? `## ${block.content}` : "";
  }
  const label = block.label ?? block.type;
  const body = block.content.trimEnd();
  return body ? `${label}:\n${body}` : `${label}:`;
}

export function serializeTranscriptionDocument(
  doc: TranscriptionDocument,
): string {
  if (doc.legacy && doc.pages.length === 1) {
    const only = doc.pages[0];
    if (only?.blocks.length === 1 && only.blocks[0]?.type === "prose") {
      return only.blocks[0].content;
    }
  }

  const parts: string[] = [];
  for (const page of doc.pages) {
    if (page.heading) {
      parts.push(`## ${page.heading}`);
    }
    for (const block of page.blocks) {
      const serialized = serializeBlock(block);
      if (serialized) parts.push(serialized);
    }
  }
  return parts.join("\n\n").trimEnd();
}

export function extractUncertainReadings(text: string): string[] {
  return [...new Set(text.match(/\[[^\]]+\?\]/g) ?? [])];
}

/** Find block index and optional cell coords containing a token. */
export function locateUncertainToken(
  doc: TranscriptionDocument,
  token: string,
): {
  pageIndex: number;
  blockIndex: number;
  rowIndex?: number;
  colIndex?: number;
} | null {
  for (let pageIndex = 0; pageIndex < doc.pages.length; pageIndex++) {
    const page = doc.pages[pageIndex];
    if (!page) continue;
    for (let blockIndex = 0; blockIndex < page.blocks.length; blockIndex++) {
      const block = page.blocks[blockIndex];
      if (!block) continue;
      if (block.type === "table" && block.table) {
        const { headers, rows } = block.table;
        if (headers.join(" ").includes(token)) {
          const colIndex = headers.findIndex((h) => h.includes(token));
          return { pageIndex, blockIndex, rowIndex: -1, colIndex };
        }
        for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
          const row = rows[rowIndex] ?? [];
          const colIndex = row.findIndex((cell) => cell.includes(token));
          if (colIndex >= 0) return { pageIndex, blockIndex, rowIndex, colIndex };
        }
      } else if (block.content.includes(token)) {
        return { pageIndex, blockIndex };
      }
    }
  }
  return null;
}

export function findPageIndexByHeading(
  doc: TranscriptionDocument,
  imageFilename: string,
): number {
  const base = imageFilename.split("/").pop() ?? imageFilename;
  for (let i = 0; i < doc.pages.length; i++) {
    const heading = doc.pages[i]?.heading;
    if (!heading) continue;
    if (heading === imageFilename || heading.endsWith(base) || heading.includes(base)) {
      return i;
    }
  }
  return -1;
}
