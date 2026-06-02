"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  forwardRef,
  type KeyboardEvent,
} from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import {
  locateUncertainToken,
  parseTranscriptionDocument,
  serializeTranscriptionDocument,
  type SectionLabel,
  type TranscriptionBlock,
  type TranscriptionDocument,
  type TranscriptionPage,
  type TranscriptionTable,
} from "@/lib/edison/transcription-document";

export interface TranscriptionFormattedEditorHandle {
  focusUncertain: (token: string) => boolean;
  scrollToPageIndex: (pageIndex: number) => void;
}

export interface TranscriptionFormattedEditorProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /** When set, scroll the matching page section into view. */
  activePageIndex?: number;
}

const SECTION_LAYOUT: Partial<
  Record<SectionLabel | "prose", string>
> = {
  Letterhead: "text-center font-medium",
  Dateline: "text-right",
  To: "pl-8 sm:pl-12",
  From: "pl-8 sm:pl-12",
  Salutation: "mt-2",
  Body: "mt-2 leading-relaxed",
  Closing: "mt-4",
  Signature: "mt-6",
  Annotations: "mt-4 text-sm italic text-muted-foreground",
  prose: "leading-relaxed",
};

function cloneDocument(doc: TranscriptionDocument): TranscriptionDocument {
  return {
    legacy: doc.legacy,
    pages: doc.pages.map((page) => ({
      heading: page.heading,
      blocks: page.blocks.map((block) => ({
        ...block,
        table: block.table
          ? {
              headers: [...block.table.headers],
              rows: block.table.rows.map((row) => [...row]),
            }
          : undefined,
      })),
    })),
  };
}

function updateBlockContent(
  doc: TranscriptionDocument,
  pageIndex: number,
  blockIndex: number,
  content: string,
): TranscriptionDocument {
  const next = cloneDocument(doc);
  const block = next.pages[pageIndex]?.blocks[blockIndex];
  if (block) block.content = content;
  return next;
}

function updateTableCell(
  doc: TranscriptionDocument,
  pageIndex: number,
  blockIndex: number,
  rowIndex: number,
  colIndex: number,
  value: string,
): TranscriptionDocument {
  const next = cloneDocument(doc);
  const table = next.pages[pageIndex]?.blocks[blockIndex]?.table;
  if (!table) return next;
  if (rowIndex < 0) {
    table.headers[colIndex] = value;
  } else {
    const row = table.rows[rowIndex] ?? [];
    row[colIndex] = value;
    table.rows[rowIndex] = row;
  }
  return next;
}

function addTableRow(
  doc: TranscriptionDocument,
  pageIndex: number,
  blockIndex: number,
): TranscriptionDocument {
  const next = cloneDocument(doc);
  const table = next.pages[pageIndex]?.blocks[blockIndex]?.table;
  if (!table) return next;
  table.rows.push(table.headers.map(() => ""));
  return next;
}

function removeTableRow(
  doc: TranscriptionDocument,
  pageIndex: number,
  blockIndex: number,
  rowIndex: number,
): TranscriptionDocument {
  const next = cloneDocument(doc);
  const table = next.pages[pageIndex]?.blocks[blockIndex]?.table;
  if (!table) return next;
  table.rows.splice(rowIndex, 1);
  return next;
}

function addTableColumn(
  doc: TranscriptionDocument,
  pageIndex: number,
  blockIndex: number,
): TranscriptionDocument {
  const next = cloneDocument(doc);
  const table = next.pages[pageIndex]?.blocks[blockIndex]?.table;
  if (!table) return next;
  table.headers.push("");
  for (const row of table.rows) {
    row.push("");
  }
  return next;
}

function removeTableColumn(
  doc: TranscriptionDocument,
  pageIndex: number,
  blockIndex: number,
  colIndex: number,
): TranscriptionDocument {
  const next = cloneDocument(doc);
  const table = next.pages[pageIndex]?.blocks[blockIndex]?.table;
  if (!table || table.headers.length <= 1) return next;
  table.headers.splice(colIndex, 1);
  for (const row of table.rows) {
    row.splice(colIndex, 1);
  }
  return next;
}

function blockDomId(pageIndex: number, blockIndex: number): string {
  return `tx-block-${pageIndex}-${blockIndex}`;
}

function SectionTextarea({
  block,
  pageIndex,
  blockIndex,
  onContentChange,
}: {
  block: TranscriptionBlock;
  pageIndex: number;
  blockIndex: number;
  onContentChange: (content: string) => void;
}) {
  const label =
    block.type === "prose"
      ? null
      : (block.label ?? block.type);
  const layoutClass =
    block.type === "prose"
      ? SECTION_LAYOUT.prose
      : SECTION_LAYOUT[block.type as SectionLabel];

  return (
    <div
      id={blockDomId(pageIndex, blockIndex)}
      data-block-id={blockDomId(pageIndex, blockIndex)}
      className={cn("rounded-sm border border-transparent px-2 py-1.5 focus-within:border-border", layoutClass)}
    >
      <textarea
        value={block.content}
        onChange={(e) => onContentChange(e.target.value)}
        spellCheck={false}
        rows={Math.max(2, Math.min(12, block.content.split("\n").length + 1))}
        className="w-full resize-y bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70"
        aria-label={label ? `${label} text` : "Transcription prose"}
      />
    </div>
  );
}

function EditableTable({
  table,
  pageIndex,
  blockIndex,
  onCellChange,
  onAddRow,
  onRemoveRow,
  onAddColumn,
  onRemoveColumn,
}: {
  table: TranscriptionTable;
  pageIndex: number;
  blockIndex: number;
  onCellChange: (rowIndex: number, colIndex: number, value: string) => void;
  onAddRow: () => void;
  onRemoveRow: (rowIndex: number) => void;
  onAddColumn: () => void;
  onRemoveColumn: (colIndex: number) => void;
}) {
  return (
    <div
      id={blockDomId(pageIndex, blockIndex)}
      data-block-id={blockDomId(pageIndex, blockIndex)}
      className="overflow-x-auto rounded-sm border border-border"
    >
      <div className="flex flex-wrap gap-1 border-b border-border bg-muted/40 px-2 py-1">
        <button
          type="button"
          onClick={onAddRow}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-foreground hover:bg-muted"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Row
        </button>
        <button
          type="button"
          onClick={onAddColumn}
          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-foreground hover:bg-muted"
        >
          <Plus className="h-3 w-3" aria-hidden="true" />
          Column
        </button>
      </div>
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            {table.headers.map((header, colIndex) => (
              <th key={colIndex} className="border-r border-border p-0 last:border-r-0">
                <input
                  type="text"
                  value={header}
                  onChange={(e) => onCellChange(-1, colIndex, e.target.value)}
                  data-cell={`h-${colIndex}`}
                  className="w-full min-w-[4rem] bg-transparent px-2 py-1.5 font-semibold outline-none focus:ring-1 focus:ring-primary/40"
                  aria-label={`Column ${colIndex + 1} header`}
                />
              </th>
            ))}
            <th className="w-8 p-0">
              <span className="sr-only">Remove column</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex} className="border-b border-border last:border-b-0">
              {table.headers.map((_, colIndex) => (
                <td key={colIndex} className="border-r border-border p-0 last:border-r-0">
                  <input
                    type="text"
                    value={row[colIndex] ?? ""}
                    onChange={(e) =>
                      onCellChange(rowIndex, colIndex, e.target.value)
                    }
                    data-cell={`${rowIndex}-${colIndex}`}
                    className="w-full min-w-[4rem] bg-transparent px-2 py-1.5 outline-none focus:ring-1 focus:ring-primary/40"
                    aria-label={`Row ${rowIndex + 1}, column ${colIndex + 1}`}
                  />
                </td>
              ))}
              <td className="p-0 text-center">
                <button
                  type="button"
                  onClick={() => onRemoveRow(rowIndex)}
                  aria-label={`Remove row ${rowIndex + 1}`}
                  className="inline-flex h-7 w-7 items-center justify-center text-muted-foreground hover:text-foreground"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {table.headers.length > 1 ? (
        <div className="flex gap-1 border-t border-border px-2 py-1">
          {table.headers.map((_, colIndex) => (
            <button
              key={colIndex}
              type="button"
              onClick={() => onRemoveColumn(colIndex)}
              className="text-[10px] text-muted-foreground hover:text-foreground"
            >
              Remove col {colIndex + 1}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PageSection({
  page,
  pageIndex,
  onDocChange,
}: {
  page: TranscriptionPage;
  pageIndex: number;
  onDocChange: (updater: (doc: TranscriptionDocument) => TranscriptionDocument) => void;
}) {
  return (
    <section
      data-page-index={pageIndex}
      className="scroll-mt-4 space-y-3 border-b border-border pb-4 last:border-b-0"
    >
      {page.heading ? (
        <h3 className="font-mono text-[11px] font-semibold text-muted-foreground">
          {page.heading}
        </h3>
      ) : null}
      {page.blocks.map((block, blockIndex) => {
        if (block.type === "table" && block.table) {
          return (
            <EditableTable
              key={blockIndex}
              table={block.table}
              pageIndex={pageIndex}
              blockIndex={blockIndex}
              onCellChange={(rowIndex, colIndex, cellValue) => {
                onDocChange((doc) =>
                  updateTableCell(
                    doc,
                    pageIndex,
                    blockIndex,
                    rowIndex,
                    colIndex,
                    cellValue,
                  ),
                );
              }}
              onAddRow={() => {
                onDocChange((doc) => addTableRow(doc, pageIndex, blockIndex));
              }}
              onRemoveRow={(rowIndex) => {
                onDocChange((doc) =>
                  removeTableRow(doc, pageIndex, blockIndex, rowIndex),
                );
              }}
              onAddColumn={() => {
                onDocChange((doc) => addTableColumn(doc, pageIndex, blockIndex));
              }}
              onRemoveColumn={(colIndex) => {
                onDocChange((doc) =>
                  removeTableColumn(doc, pageIndex, blockIndex, colIndex),
                );
              }}
            />
          );
        }
        return (
          <SectionTextarea
            key={blockIndex}
            block={block}
            pageIndex={pageIndex}
            blockIndex={blockIndex}
            onContentChange={(content) => {
              onDocChange((doc) =>
                updateBlockContent(doc, pageIndex, blockIndex, content),
              );
            }}
          />
        );
      })}
    </section>
  );
}

export const TranscriptionFormattedEditor = forwardRef<
  TranscriptionFormattedEditorHandle,
  TranscriptionFormattedEditorProps
>(function TranscriptionFormattedEditor(
  { value, onChange, className, activePageIndex },
  ref,
) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<"formatted" | "source">("formatted");
  const [doc, setDoc] = useState(() => parseTranscriptionDocument(value));
  const lastExternalValue = useRef(value);

  useEffect(() => {
    if (value !== lastExternalValue.current) {
      lastExternalValue.current = value;
      setDoc(parseTranscriptionDocument(value));
    }
  }, [value]);

  const emitChange = useCallback(
    (nextDoc: TranscriptionDocument) => {
      setDoc(nextDoc);
      const serialized = serializeTranscriptionDocument(nextDoc);
      lastExternalValue.current = serialized;
      onChange(serialized);
    },
    [onChange],
  );

  const handleDocChange = useCallback(
    (updater: (d: TranscriptionDocument) => TranscriptionDocument) => {
      emitChange(updater(doc));
    },
    [doc, emitChange],
  );

  const handleRawChange = useCallback(
    (raw: string) => {
      lastExternalValue.current = raw;
      setDoc(parseTranscriptionDocument(raw));
      onChange(raw);
    },
    [onChange],
  );

  useImperativeHandle(
    ref,
    () => ({
      focusUncertain(token: string) {
        const loc = locateUncertainToken(doc, token);
        if (!loc) return false;
        setMode("formatted");
        const id = blockDomId(loc.pageIndex, loc.blockIndex);
        requestAnimationFrame(() => {
          const el = scrollRef.current?.querySelector(`#${CSS.escape(id)}`);
          if (
            el instanceof HTMLElement &&
            typeof el.scrollIntoView === "function"
          ) {
            el.scrollIntoView({ block: "center", behavior: "smooth" });
          }
          if (
            loc.rowIndex !== undefined &&
            loc.colIndex !== undefined &&
            loc.rowIndex >= 0
          ) {
            const input = scrollRef.current?.querySelector(
              `#${CSS.escape(id)} [data-cell="${loc.rowIndex}-${loc.colIndex}"]`,
            );
            if (input instanceof HTMLInputElement) {
              input.focus();
              input.select();
              return true;
            }
          }
          const textarea = scrollRef.current?.querySelector(
            `#${CSS.escape(id)} textarea`,
          );
          if (textarea instanceof HTMLTextAreaElement) {
            textarea.focus();
            const idx = textarea.value.indexOf(token);
            if (idx >= 0) {
              textarea.setSelectionRange(idx, idx + token.length);
            }
            return true;
          }
        });
        return true;
      },
      scrollToPageIndex(pageIndex: number) {
        if (pageIndex < 0) return;
        const section = scrollRef.current?.querySelector(
          `[data-page-index="${pageIndex}"]`,
        );
        if (
          section instanceof HTMLElement &&
          typeof section.scrollIntoView === "function"
        ) {
          section.scrollIntoView({ block: "start", behavior: "smooth" });
        }
      },
    }),
    [doc],
  );

  useEffect(() => {
    if (activePageIndex === undefined || activePageIndex < 0) return;
    if (mode !== "formatted") return;
    const section = scrollRef.current?.querySelector(
      `[data-page-index="${activePageIndex}"]`,
    );
    if (
      section instanceof HTMLElement &&
      typeof section.scrollIntoView === "function"
    ) {
      section.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [activePageIndex, mode]);

  const showFormatted = useMemo(
    () => !doc.legacy || doc.pages.some((p) => p.blocks.some((b) => b.type !== "prose")),
    [doc],
  );

  return (
    <Tabs
      value={mode}
      onValueChange={(v) => setMode(v as "formatted" | "source")}
      className={cn("flex h-full min-h-0 flex-col", className)}
    >
      <TabsList className="mx-0 mb-2 h-7 w-fit shrink-0">
        <TabsTrigger value="formatted" className="text-[11px] px-2 py-0.5">
          Formatted
        </TabsTrigger>
        <TabsTrigger value="source" className="text-[11px] px-2 py-0.5">
          Source
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="formatted"
        className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
      >
        <div
          ref={scrollRef}
          className="h-full overflow-y-auto font-serif"
        >
          {doc.legacy && !showFormatted ? (
            <SectionTextarea
              block={doc.pages[0]?.blocks[0] ?? { type: "prose", content: value }}
              pageIndex={0}
              blockIndex={0}
              onContentChange={(content) => {
                emitChange({
                  legacy: true,
                  pages: [{ heading: null, blocks: [{ type: "prose", content }] }],
                });
              }}
            />
          ) : (
            doc.pages.map((page, pageIndex) => (
              <PageSection
                key={pageIndex}
                page={page}
                pageIndex={pageIndex}
                onDocChange={handleDocChange}
              />
            ))
          )}
        </div>
      </TabsContent>
      <TabsContent
        value="source"
        className="mt-0 min-h-0 flex-1 overflow-hidden data-[state=inactive]:hidden"
      >
        <textarea
          value={value}
          onChange={(e) => handleRawChange(e.target.value)}
          onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "s") {
              e.preventDefault();
              e.currentTarget.dispatchEvent(
                new CustomEvent("transcription-save", { bubbles: true }),
              );
            }
          }}
          spellCheck={false}
          className="block h-full min-h-[160px] w-full resize-none rounded-sm border border-border bg-card px-3 py-3 font-mono text-[13px] leading-6 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          aria-label="Transcription source (Markdown)"
        />
      </TabsContent>
    </Tabs>
  );
});
