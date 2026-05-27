"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  Download,
  Grid3x3,
  Image as ImageIcon,
  ListTree,
  Maximize2,
  Minus,
  PanelLeft,
  PanelRight,
  Plus,
  RotateCw,
  Settings,
  Share2,
  Square,
} from "lucide-react";
import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { toast } from "sonner";
import { motionSpring } from "@/components/motion-primitives";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { DocumentPackage, PageImage, TranscriptionRun } from "@/lib/edison/types";

export type DocumentViewerMode = "workbench" | "embed";
export type DocumentViewerPanel = "transcription" | "thumbnails" | "both";
export type DocumentViewerTheme = "light" | "dark";

export interface DocumentViewerProps {
  document: DocumentPackage;
  transcription: TranscriptionRun;
  mode?: DocumentViewerMode;
  initialPage?: number;
  initialPanel?: DocumentViewerPanel;
  theme?: DocumentViewerTheme;
  onPageChange?: (page: number) => void;
  onTranscriptionChange?: (text: string) => void;
  className?: string;
}

type ViewLayout = "single" | "two-page" | "grid";

interface PostMessageEnvelope {
  source: "edison-viewer";
  type: "pageChanged" | "transcriptionChanged" | "setPage" | "setPanel";
  payload: unknown;
}

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

export function DocumentViewer({
  document,
  transcription,
  mode = "workbench",
  initialPage = 1,
  initialPanel = "transcription",
  theme = "light",
  onPageChange,
  onTranscriptionChange,
  className,
}: DocumentViewerProps) {
  const pages = document.pages;
  const pageCount = pages.length;
  const hasPages = pageCount > 0;

  const clampedInitialPage = Math.min(Math.max(initialPage, 1), Math.max(pageCount, 1));
  const [activePage, setActivePage] = useState(clampedInitialPage - 1);
  const [pageInput, setPageInput] = useState(String(clampedInitialPage));
  const [viewLayout, setViewLayout] = useState<ViewLayout>("single");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [leftOpen, setLeftOpen] = useState(
    initialPanel === "thumbnails" || initialPanel === "both",
  );
  const [rightOpen, setRightOpen] = useState(
    initialPanel === "transcription" || initialPanel === "both",
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editedText, setEditedText] = useState(transcription.diplomaticText);
  const [lastTranscriptionId, setLastTranscriptionId] = useState(transcription.id);
  const [lastActivePage, setLastActivePage] = useState(activePage);
  const [scrollHint, setScrollHint] = useState<{
    top: number;
    height: number;
    key: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  if (lastTranscriptionId !== transcription.id) {
    setLastTranscriptionId(transcription.id);
    setEditedText(transcription.diplomaticText);
  }

  if (lastActivePage !== activePage) {
    setLastActivePage(activePage);
    setPageInput(String(activePage + 1));
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }

  useEffect(() => {
    onPageChange?.(activePage + 1);
  }, [activePage, onPageChange]);

  useEffect(() => {
    if (mode !== "embed" || typeof window === "undefined") {
      return;
    }
    window.parent?.postMessage(
      {
        source: "edison-viewer",
        type: "pageChanged",
        payload: { page: activePage + 1, documentId: document.documentId },
      } satisfies PostMessageEnvelope,
      "*",
    );
  }, [activePage, document.documentId, mode]);

  useEffect(() => {
    if (mode !== "embed" || typeof window === "undefined") {
      return;
    }
    function handleMessage(event: MessageEvent<PostMessageEnvelope>) {
      const data = event.data;
      if (!data || typeof data !== "object" || data.source !== "edison-viewer") {
        return;
      }
      if (data.type === "setPage") {
        const payload = data.payload as { page?: number } | undefined;
        const nextPage = Number(payload?.page ?? 1);
        if (Number.isFinite(nextPage) && pageCount > 0) {
          setActivePage(Math.min(Math.max(nextPage - 1, 0), pageCount - 1));
        }
      } else if (data.type === "setPanel") {
        const payload = data.payload as { panel?: DocumentViewerPanel } | undefined;
        const panel = payload?.panel;
        if (panel === "transcription") {
          setLeftOpen(false);
          setRightOpen(true);
        } else if (panel === "thumbnails") {
          setLeftOpen(true);
          setRightOpen(false);
        } else if (panel === "both") {
          setLeftOpen(true);
          setRightOpen(true);
        }
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [mode, pageCount]);

  useEffect(() => {
    if (!textareaRef.current || pageCount <= 1) {
      return;
    }
    const ta = textareaRef.current;
    const ratio = activePage / Math.max(1, pageCount - 1);
    const sliceHeight = ta.scrollHeight / pageCount;
    const targetTop = ratio * Math.max(0, ta.scrollHeight - ta.clientHeight);
    if (typeof ta.scrollTo === "function") {
      ta.scrollTo({ top: targetTop, behavior: "smooth" });
    } else {
      ta.scrollTop = targetTop;
    }
    setScrollHint({
      top: sliceHeight * activePage,
      height: sliceHeight,
      key: Date.now(),
    });
    const timeout = window.setTimeout(() => setScrollHint(null), 1400);
    return () => window.clearTimeout(timeout);
  }, [activePage, pageCount, editedText.length]);

  const goTo = useCallback(
    (index: number) => {
      if (!hasPages) return;
      setActivePage(Math.min(Math.max(index, 0), pageCount - 1));
    },
    [hasPages, pageCount],
  );

  const submitPageInput = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const parsed = Number.parseInt(pageInput, 10);
      if (Number.isFinite(parsed)) {
        goTo(parsed - 1);
      } else {
        setPageInput(String(activePage + 1));
      }
    },
    [activePage, goTo, pageInput],
  );

  const handleKeyNav = useCallback(
    (event: globalThis.KeyboardEvent) => {
      if (!hasPages) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) {
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(activePage + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(activePage - 1);
      }
    },
    [activePage, goTo, hasPages],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyNav);
    return () => window.removeEventListener("keydown", handleKeyNav);
  }, [handleKeyNav]);

  function adjustZoom(delta: number) {
    setZoom((current) => clamp(round2(current + delta), ZOOM_MIN, ZOOM_MAX));
  }

  function setZoomExact(value: number) {
    setZoom(clamp(round2(value), ZOOM_MIN, ZOOM_MAX));
  }

  function resetView() {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }

  function rotate90() {
    setRotation((current) => (current + 90) % 360);
  }

  function handleStagePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!stageRef.current) return;
    if (zoom <= 1) return;
    stageRef.current.setPointerCapture(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      panX: pan.x,
      panY: pan.y,
    };
  }

  function handleStagePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setPan({
      x: drag.panX + (event.clientX - drag.startX),
      y: drag.panY + (event.clientY - drag.startY),
    });
  }

  function handleStagePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!stageRef.current) return;
    if (stageRef.current.hasPointerCapture(event.pointerId)) {
      stageRef.current.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  function handleStageWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    adjustZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
  }

  function handleStageDoubleClick() {
    if (zoom > 1) {
      resetView();
    } else {
      setZoomExact(2);
    }
  }

  function handleTextareaChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = event.target.value;
    setEditedText(next);
    onTranscriptionChange?.(next);
    if (mode === "embed" && typeof window !== "undefined") {
      window.parent?.postMessage(
        {
          source: "edison-viewer",
          type: "transcriptionChanged",
          payload: { text: next, documentId: document.documentId },
        } satisfies PostMessageEnvelope,
        "*",
      );
    }
  }

  function selectUncertain(token: string) {
    const ta = textareaRef.current;
    if (!ta) return;
    const idx = editedText.indexOf(token);
    if (idx < 0) {
      toast.info("Reading no longer present in transcription.");
      return;
    }
    ta.focus();
    ta.setSelectionRange(idx, idx + token.length);
    const lineHeight = 24;
    const approxLine = (editedText.slice(0, idx).match(/\n/g) ?? []).length;
    const targetTop = Math.max(0, approxLine * lineHeight - 64);
    if (typeof ta.scrollTo === "function") {
      ta.scrollTo({ top: targetTop, behavior: "smooth" });
    } else {
      ta.scrollTop = targetTop;
    }
  }

  async function handleShare() {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    params.set("page", String(activePage + 1));
    if (rightOpen && !leftOpen) params.set("panel", "transcription");
    else if (leftOpen && !rightOpen) params.set("panel", "thumbnails");
    else if (leftOpen && rightOpen) params.set("panel", "both");
    const href = `${window.location.origin}/viewer/${document.documentId}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(href);
      toast.success("Embed link copied", { description: href });
    } catch {
      toast.message("Embed link", { description: href });
    }
  }

  function handleFullscreen() {
    const node = containerRef.current;
    if (!node) return;
    if (window.document.fullscreenElement) {
      window.document.exitFullscreen().catch(() => undefined);
    } else {
      node.requestFullscreen?.().catch(() => undefined);
    }
  }

  function handleDownload() {
    const sourceName = document.sourceFile.name;
    toast.info("Source file download", {
      description: `${sourceName} would be streamed from the archival store.`,
    });
  }

  const currentPage = hasPages ? pages[activePage] : undefined;
  const adjacentPage =
    viewLayout === "two-page" && hasPages ? pages[activePage + 1] : undefined;

  const characterCount = editedText.length;
  const uncertain = transcription.uncertainReadings ?? [];

  const wrapperTheme =
    theme === "dark" ? "edison-viewer-dark" : "edison-viewer-light";

  return (
    <section
      ref={containerRef}
      data-mode={mode}
      data-theme={theme}
      aria-label="Source and transcription viewer"
      className={cn(
        "edison-viewer relative overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_60px_-30px_rgba(0,0,0,0.18)]",
        wrapperTheme,
        mode === "embed" ? "h-full min-h-[640px]" : "min-h-[680px]",
        className,
      )}
    >
      <Toolbar
        activePage={activePage}
        pageCount={pageCount}
        pageInput={pageInput}
        onPageInputChange={setPageInput}
        onPageSubmit={submitPageInput}
        onFirst={() => goTo(0)}
        onPrev={() => goTo(activePage - 1)}
        onNext={() => goTo(activePage + 1)}
        onLast={() => goTo(pageCount - 1)}
        viewLayout={viewLayout}
        onLayoutChange={setViewLayout}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((value) => !value)}
        onToggleRight={() => setRightOpen((value) => !value)}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((value) => !value)}
        zoom={zoom}
        onZoomIn={() => adjustZoom(ZOOM_STEP)}
        onZoomOut={() => adjustZoom(-ZOOM_STEP)}
        onRotate={rotate90}
        onReset={resetView}
        title={document.title}
      />

      <div
        className={cn(
          "grid min-h-[560px] gap-px bg-border/70",
          gridColsClass(leftOpen, rightOpen),
        )}
      >
        {leftOpen ? (
          <ContentsRail
            pages={pages}
            activePage={activePage}
            onSelect={goTo}
            onClose={() => setLeftOpen(false)}
            documentTitle={document.title}
          />
        ) : null}

        <SourceStage
          stageRef={stageRef}
          currentPage={currentPage}
          adjacentPage={adjacentPage}
          viewLayout={viewLayout}
          pages={pages}
          activePage={activePage}
          onSelectPage={goTo}
          zoom={zoom}
          pan={pan}
          rotation={rotation}
          settingsOpen={settingsOpen}
          onCloseSettings={() => setSettingsOpen(false)}
          onZoomSlider={setZoomExact}
          onRotate={rotate90}
          onReset={resetView}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
          onWheel={handleStageWheel}
          onDoubleClick={handleStageDoubleClick}
        />

        {rightOpen ? (
          <TranscriptionPane
            textareaRef={textareaRef}
            editedText={editedText}
            characterCount={characterCount}
            transcription={transcription}
            uncertain={uncertain}
            onChange={handleTextareaChange}
            onSelectUncertain={selectUncertain}
            scrollHint={scrollHint}
            onClose={() => setRightOpen(false)}
          />
        ) : null}
      </div>

      <BottomBar
        onDownload={handleDownload}
        onShare={handleShare}
        onFullscreen={handleFullscreen}
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        onToggleLeft={() => setLeftOpen((value) => !value)}
        onToggleRight={() => setRightOpen((value) => !value)}
        documentId={document.documentId}
        pageIndicator={hasPages ? `${activePage + 1} / ${pageCount}` : "—"}
      />
    </section>
  );
}

function gridColsClass(leftOpen: boolean, rightOpen: boolean) {
  if (leftOpen && rightOpen) {
    return "lg:grid-cols-[220px_minmax(0,1fr)_minmax(320px,0.85fr)] grid-cols-1";
  }
  if (leftOpen) {
    return "lg:grid-cols-[220px_minmax(0,1fr)] grid-cols-1";
  }
  if (rightOpen) {
    return "lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)] grid-cols-1";
  }
  return "grid-cols-1";
}

interface ToolbarProps {
  activePage: number;
  pageCount: number;
  pageInput: string;
  onPageInputChange: (value: string) => void;
  onPageSubmit: (event?: FormEvent) => void;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  viewLayout: ViewLayout;
  onLayoutChange: (value: ViewLayout) => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onRotate: () => void;
  onReset: () => void;
  title: string;
}

function Toolbar({
  activePage,
  pageCount,
  pageInput,
  onPageInputChange,
  onPageSubmit,
  onFirst,
  onPrev,
  onNext,
  onLast,
  viewLayout,
  onLayoutChange,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  settingsOpen,
  onToggleSettings,
  zoom,
  onZoomIn,
  onZoomOut,
  onRotate,
  onReset,
  title,
}: ToolbarProps) {
  const atFirst = activePage <= 0;
  const atLast = activePage >= pageCount - 1;
  return (
    <div
      role="toolbar"
      aria-label="Viewer controls"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 bg-[oklch(0.18_0.005_95)] px-3 py-2 text-[oklch(0.92_0.003_95)]"
    >
      <div className="flex items-center gap-2">
        <ToolbarIconButton
          ariaLabel={leftOpen ? "Hide contents" : "Show contents"}
          onClick={onToggleLeft}
          active={leftOpen}
        >
          <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
        </ToolbarIconButton>

        <ToolbarIconButton
          ariaLabel="First page"
          onClick={onFirst}
          disabled={atFirst || pageCount === 0}
        >
          <ChevronsLeft className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
        <ToolbarIconButton
          ariaLabel="Previous page"
          onClick={onPrev}
          disabled={atFirst || pageCount === 0}
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>

        <form
          onSubmit={onPageSubmit}
          className="flex items-center gap-1.5 rounded-md bg-white/10 px-1.5 py-1 text-[12px]"
        >
          <span className="ml-0.5 text-[11px] uppercase tracking-[0.14em] text-white/70">
            Image
          </span>
          <input
            inputMode="numeric"
            pattern="[0-9]*"
            value={pageInput}
            onChange={(event) => onPageInputChange(event.target.value)}
            onBlur={() => onPageSubmit()}
            aria-label="Go to page"
            disabled={pageCount === 0}
            className="h-6 w-12 rounded-sm bg-white/10 px-1 text-center font-mono text-[12px] text-white outline-none ring-1 ring-inset ring-white/15 focus:ring-amber-300/60 disabled:opacity-50"
          />
          <span className="text-[11px] text-white/70">of {pageCount || 0}</span>
          <button
            type="submit"
            disabled={pageCount === 0}
            className="ml-1 inline-flex h-6 items-center justify-center rounded-sm bg-amber-500/90 px-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Go
          </button>
        </form>

        <ToolbarIconButton
          ariaLabel="Next page"
          onClick={onNext}
          disabled={atLast || pageCount === 0}
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
        <ToolbarIconButton
          ariaLabel="Last page"
          onClick={onLast}
          disabled={atLast || pageCount === 0}
        >
          <ChevronsRight className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
      </div>

      <div className="hidden min-w-0 flex-1 items-center justify-center px-4 lg:flex">
        <p className="truncate text-[12px] text-white/75" title={title}>
          {title}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        <div
          role="group"
          aria-label="Page layout"
          className="inline-flex items-center gap-px overflow-hidden rounded-md bg-white/10 p-0.5"
        >
          <LayoutToggle
            label="Single page"
            active={viewLayout === "single"}
            onClick={() => onLayoutChange("single")}
          >
            <Square className="h-3.5 w-3.5" strokeWidth={1.8} />
          </LayoutToggle>
          <LayoutToggle
            label="Two-page spread"
            active={viewLayout === "two-page"}
            onClick={() => onLayoutChange("two-page")}
            disabled={pageCount < 2}
          >
            <Columns2 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </LayoutToggle>
          <LayoutToggle
            label="Grid"
            active={viewLayout === "grid"}
            onClick={() => onLayoutChange("grid")}
            disabled={pageCount < 2}
          >
            <Grid3x3 className="h-3.5 w-3.5" strokeWidth={1.8} />
          </LayoutToggle>
        </div>

        <ToolbarIconButton ariaLabel="Zoom out" onClick={onZoomOut}>
          <Minus className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
        <span className="font-mono text-[11px] tabular-nums text-white/70">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarIconButton ariaLabel="Zoom in" onClick={onZoomIn}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
        <ToolbarIconButton ariaLabel="Rotate 90 degrees" onClick={onRotate}>
          <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
        <ToolbarIconButton ariaLabel="Reset view" onClick={onReset}>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.08em]">
            1:1
          </span>
        </ToolbarIconButton>
        <ToolbarIconButton
          ariaLabel="Viewer settings"
          onClick={onToggleSettings}
          active={settingsOpen}
        >
          <Settings className="h-3.5 w-3.5" strokeWidth={1.8} />
        </ToolbarIconButton>
        <ToolbarIconButton
          ariaLabel={rightOpen ? "Hide information panel" : "Show information panel"}
          onClick={onToggleRight}
          active={rightOpen}
        >
          <PanelRight className="h-3.5 w-3.5" strokeWidth={1.8} />
        </ToolbarIconButton>
      </div>
    </div>
  );
}

function ToolbarIconButton({
  children,
  onClick,
  disabled,
  ariaLabel,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-white/85 transition-colors",
        "hover:bg-white/15 hover:text-white",
        active ? "bg-white/20 text-white" : "",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

function LayoutToggle({
  children,
  active,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cn(
        "inline-flex h-6 w-7 items-center justify-center rounded-sm text-white/80 transition-colors",
        active ? "bg-white/25 text-white" : "hover:bg-white/15",
        "disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent",
      )}
    >
      {children}
    </button>
  );
}

interface ContentsRailProps {
  pages: PageImage[];
  activePage: number;
  onSelect: (index: number) => void;
  onClose: () => void;
  documentTitle: string;
}

function ContentsRail({
  pages,
  activePage,
  onSelect,
  onClose,
  documentTitle,
}: ContentsRailProps) {
  const [tab, setTab] = useState<"thumbnails" | "index">("thumbnails");
  return (
    <aside
      aria-label="Document contents"
      className="flex min-h-full flex-col bg-[oklch(0.97_0.003_95)]"
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-card px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Contents
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide contents"
          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
          <ChevronLeft
            className="-ml-2 h-3.5 w-3.5"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </button>
      </div>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as "thumbnails" | "index")}
        className="px-3 pt-2"
      >
        <TabsList className="h-7 w-full">
          <TabsTrigger value="index" className="flex-1 text-[12px]">
            <ListTree className="h-3.5 w-3.5" strokeWidth={1.6} />
            Index
          </TabsTrigger>
          <TabsTrigger value="thumbnails" className="flex-1 text-[12px]">
            <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.6} />
            Thumbs
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2">
        {tab === "thumbnails" ? (
          <ul className="grid grid-cols-2 gap-2.5">
            {pages.map((page, index) => (
              <li key={page.id}>
                <ThumbnailButton
                  page={page}
                  active={index === activePage}
                  onClick={() => onSelect(index)}
                />
              </li>
            ))}
            {pages.length === 0 ? (
              <li className="col-span-2 rounded-md border border-dashed border-border/70 bg-card px-3 py-4 text-center text-[12px] text-muted-foreground">
                No pages available for this document.
              </li>
            ) : null}
          </ul>
        ) : (
          <ol className="space-y-1.5">
            <li className="rounded-md bg-card px-2.5 py-2 text-[12px]">
              <p className="font-semibold text-foreground">{documentTitle}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {pages.length} page{pages.length === 1 ? "" : "s"}
              </p>
            </li>
            {pages.map((page, index) => (
              <li key={page.id}>
                <button
                  type="button"
                  onClick={() => onSelect(index)}
                  className={cn(
                    "block w-full rounded-md border px-2.5 py-1.5 text-left text-[12px] transition-colors",
                    index === activePage
                      ? "border-amber-300/80 bg-amber-50 text-amber-900 shadow-[inset_0_0_0_1px_rgba(217,119,6,0.18)]"
                      : "border-transparent bg-card hover:border-border/70 hover:bg-muted/60",
                  )}
                >
                  <span className="font-mono text-[11px] text-muted-foreground">
                    Page {page.sourcePage}
                  </span>
                  <span className="ml-2 break-all text-foreground">
                    {page.imageFilename}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function ThumbnailButton({
  page,
  active,
  onClick,
}: {
  page: PageImage;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Go to page ${page.sourcePage}`}
      aria-pressed={active}
      className={cn(
        "group block w-full overflow-hidden rounded-md border bg-card text-left transition-all",
        active
          ? "border-amber-400/80 shadow-[0_0_0_2px_rgba(217,119,6,0.18)]"
          : "border-border/70 hover:border-border hover:shadow-[0_4px_10px_-6px_rgba(0,0,0,0.15)]",
      )}
    >
      <div className="relative aspect-[3/4] w-full bg-[oklch(0.97_0.005_85)]">
        {page.originalUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.originalUrl}
            alt={`Thumbnail of page ${page.sourcePage}`}
            className="h-full w-full object-cover"
            loading="lazy"
          />
        ) : (
          <FacsimileMiniature />
        )}
        <span className="pointer-events-none absolute bottom-1 right-1 rounded-sm bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
          {page.sourcePage}
        </span>
      </div>
    </button>
  );
}

function FacsimileMiniature() {
  return (
    <div className="flex h-full w-full flex-col gap-1.5 bg-[oklch(0.97_0.012_85)] p-2.5">
      <span className="h-1 w-2/3 rounded-full bg-foreground/15" />
      <span className="h-1 w-full rounded-full bg-foreground/10" />
      <span className="h-1 w-5/6 rounded-full bg-foreground/10" />
      <span className="h-1 w-4/6 rounded-full bg-foreground/10" />
      <span className="mt-auto h-1 w-1/2 rounded-full bg-foreground/15" />
    </div>
  );
}

interface SourceStageProps {
  stageRef: React.RefObject<HTMLDivElement | null>;
  currentPage?: PageImage;
  adjacentPage?: PageImage;
  viewLayout: ViewLayout;
  pages: PageImage[];
  activePage: number;
  onSelectPage: (index: number) => void;
  zoom: number;
  pan: { x: number; y: number };
  rotation: number;
  settingsOpen: boolean;
  onCloseSettings: () => void;
  onZoomSlider: (value: number) => void;
  onRotate: () => void;
  onReset: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onWheel: (event: ReactWheelEvent<HTMLDivElement>) => void;
  onDoubleClick: () => void;
}

function SourceStage({
  stageRef,
  currentPage,
  adjacentPage,
  viewLayout,
  pages,
  activePage,
  onSelectPage,
  zoom,
  pan,
  rotation,
  settingsOpen,
  onCloseSettings,
  onZoomSlider,
  onRotate,
  onReset,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onWheel,
  onDoubleClick,
}: SourceStageProps) {
  const stageStyle: CSSProperties = {
    backgroundImage:
      "radial-gradient(circle at 20% 0%, rgba(255,255,255,0.04), transparent 60%), radial-gradient(circle at 80% 100%, rgba(255,255,255,0.03), transparent 60%)",
  };

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotation}deg)`;
  const cursorClass =
    zoom > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in";

  return (
    <div
      ref={stageRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onWheel={onWheel}
      onDoubleClick={onDoubleClick}
      style={stageStyle}
      className={cn(
        "relative flex min-h-[520px] items-center justify-center overflow-hidden bg-[oklch(0.16_0.004_95)] p-6 sm:p-10",
        cursorClass,
      )}
    >
      {viewLayout === "grid" ? (
        <GridLayout
          pages={pages}
          activePage={activePage}
          onSelect={onSelectPage}
        />
      ) : currentPage ? (
        <motion.div
          key={`${currentPage.id}-${viewLayout}`}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={motionSpring}
          className="flex items-center justify-center gap-6"
          style={{ transform, transformOrigin: "center center" }}
        >
          <PageRender page={currentPage} />
          {viewLayout === "two-page" && adjacentPage ? (
            <PageRender page={adjacentPage} />
          ) : null}
        </motion.div>
      ) : (
        <EmptyStage />
      )}

      {currentPage ? (
        <AttributionChip filename={currentPage.imageFilename} />
      ) : null}

      {settingsOpen ? (
        <SettingsPopover
          zoom={zoom}
          onZoomSlider={onZoomSlider}
          onRotate={onRotate}
          onReset={onReset}
          onClose={onCloseSettings}
        />
      ) : null}
    </div>
  );
}

function GridLayout({
  pages,
  activePage,
  onSelect,
}: {
  pages: PageImage[];
  activePage: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="grid w-full max-w-3xl grid-cols-2 gap-4 sm:grid-cols-3">
      {pages.map((page, index) => (
        <button
          key={page.id}
          type="button"
          onClick={() => onSelect(index)}
          aria-label={`Go to page ${page.sourcePage}`}
          className={cn(
            "group overflow-hidden rounded-lg border bg-card text-left transition-all",
            index === activePage
              ? "border-amber-400 shadow-[0_0_0_3px_rgba(217,119,6,0.25)]"
              : "border-white/10 hover:border-white/30",
          )}
        >
          <div className="relative aspect-[3/4] w-full bg-[oklch(0.97_0.012_85)]">
            {page.originalUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={page.originalUrl}
                alt={`Page ${page.sourcePage}`}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            ) : (
              <FacsimileMiniature />
            )}
            <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-sm bg-black/65 px-1.5 py-0.5 font-mono text-[11px] text-white">
              Page {page.sourcePage}
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}

function PageRender({ page }: { page: PageImage }) {
  if (page.originalUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={page.originalUrl}
        alt={`Page ${page.sourcePage}`}
        draggable={false}
        className="max-h-[70vh] w-auto max-w-full select-none rounded-md shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]"
      />
    );
  }
  return <FacsimileSheet page={page} />;
}

function FacsimileSheet({ page }: { page: PageImage }) {
  return (
    <article
      role="img"
      aria-label={`Page ${page.sourcePage} facsimile (source image not yet attached)`}
      className="relative w-[min(560px,82vw)] rounded-md border border-[oklch(0.85_0.02_85)] bg-[linear-gradient(180deg,oklch(0.985_0.015_85)_0%,oklch(0.96_0.025_80)_100%)] p-10 text-[oklch(0.28_0.02_70)] shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_20px_60px_-30px_rgba(0,0,0,0.55)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-10 top-7 h-[1px] bg-[oklch(0.78_0.04_75)]/60"
      />
      <header className="mb-6 flex items-center justify-between text-[10px] uppercase tracking-[0.22em] text-[oklch(0.45_0.04_70)]">
        <span>Edison Papers Facsimile</span>
        <span className="font-mono">Page {page.sourcePage}</span>
      </header>
      <div className="space-y-3 text-[15px] leading-7">
        <p>
          <span className="font-semibold">Letterhead:</span> Edison Electric Light
          Co. of Philadelphia
        </p>
        <p>
          <span className="font-semibold">Dateline:</span> Philadelphia, Jan. 12,
          1890
        </p>
        <p>
          Body: Mr. Marks reports on the{" "}
          <span className="rounded-sm bg-amber-200/60 px-1 underline decoration-amber-700/60 decoration-2 underline-offset-[5px]">
            [filament?]
          </span>{" "}
          tests and station materials.
        </p>
        <p>
          <span className="font-semibold">Signature:</span> W. D. Marks
        </p>
      </div>
      <footer className="mt-10 flex items-center justify-between text-[10px] uppercase tracking-[0.18em] text-[oklch(0.5_0.04_70)]">
        <span className="font-mono">{page.imageFilename}</span>
        <span>Source image not yet attached</span>
      </footer>
    </article>
  );
}

function AttributionChip({ filename }: { filename: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute bottom-3 left-3 max-w-[260px] rounded-md border border-white/10 bg-black/55 px-3 py-2 text-[11px] leading-snug text-white/85 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] backdrop-blur",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/65">
        Attribution
      </p>
      <p className="mt-0.5">
        Thomas A. Edison Papers, Rutgers University.
        <br />
        Terms of use:{" "}
        <span className="font-medium text-amber-200/95">CC-BY-NC 4.0</span>
      </p>
      <p className="mt-1 font-mono text-[10px] text-white/55">{filename}</p>
    </div>
  );
}

function SettingsPopover({
  zoom,
  onZoomSlider,
  onRotate,
  onReset,
  onClose,
}: {
  zoom: number;
  onZoomSlider: (value: number) => void;
  onRotate: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Viewer settings"
      className="absolute right-3 top-3 z-10 w-60 rounded-lg border border-white/10 bg-card p-3 text-sm shadow-[0_24px_60px_-20px_rgba(0,0,0,0.45)]"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          View settings
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          className="rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
        >
          Close
        </button>
      </div>
      <label className="mt-3 block text-[11px] font-medium text-foreground">
        Zoom
        <input
          type="range"
          min={ZOOM_MIN}
          max={ZOOM_MAX}
          step={ZOOM_STEP}
          value={zoom}
          onChange={(event) => onZoomSlider(Number(event.target.value))}
          aria-valuetext={`${Math.round(zoom * 100)}%`}
          className="mt-1.5 block w-full accent-amber-500"
        />
        <span className="font-mono text-[11px] text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
      </label>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onRotate}
          className="inline-flex h-7 items-center justify-center gap-1 rounded-md border border-border bg-card text-[12px] hover:bg-muted"
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          Rotate
        </button>
        <button
          type="button"
          onClick={onReset}
          className="inline-flex h-7 items-center justify-center rounded-md border border-border bg-card text-[12px] hover:bg-muted"
        >
          Reset
        </button>
      </div>
    </div>
  );
}

function EmptyStage() {
  return (
    <div className="rounded-xl border border-dashed border-white/15 bg-white/5 px-8 py-10 text-center text-white/80">
      <p className="text-base font-semibold">No extracted pages available.</p>
      <p className="mt-2 text-sm text-white/65">
        This file is blocked or unsupported and should be handled manually.
      </p>
    </div>
  );
}

interface TranscriptionPaneProps {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  editedText: string;
  characterCount: number;
  transcription: TranscriptionRun;
  uncertain: string[];
  onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onSelectUncertain: (token: string) => void;
  scrollHint: { top: number; height: number; key: number } | null;
  onClose: () => void;
}

function TranscriptionPane({
  textareaRef,
  editedText,
  characterCount,
  transcription,
  uncertain,
  onChange,
  onSelectUncertain,
  scrollHint,
  onClose,
}: TranscriptionPaneProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      toast.info("Use Save review action below to commit changes.");
    }
  }
  return (
    <aside
      aria-label="Transcription editor"
      className="flex min-h-full flex-col bg-card"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-700/90">
            More information
          </p>
          <label
            htmlFor="transcription"
            className="mt-0.5 block truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground"
          >
            Diplomatic transcription
          </label>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            Preserve original spelling, abbreviations, punctuation, annotations,
            and uncertainty marks.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Hide transcription panel"
          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />
          <ChevronRight
            className="-ml-2 h-3.5 w-3.5"
            strokeWidth={1.8}
            aria-hidden="true"
          />
        </button>
      </header>

      {uncertain.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 bg-amber-50/50 px-4 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-amber-900/80">
            Uncertain ({uncertain.length})
          </span>
          {uncertain.map((token) => (
            <button
              key={token}
              type="button"
              onClick={() => onSelectUncertain(token)}
              className="inline-flex items-center rounded-full border border-amber-300/80 bg-white px-2 py-0.5 font-mono text-[11px] text-amber-900 transition-colors hover:bg-amber-100"
            >
              {token}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 px-4 py-3">
        {scrollHint ? (
          <motion.div
            key={scrollHint.key}
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: "easeOut" }}
            aria-hidden="true"
            className="pointer-events-none absolute left-4 right-6 rounded-md bg-amber-300/40 ring-1 ring-amber-400/40"
            style={{ top: scrollHint.top + 12, height: scrollHint.height }}
          />
        ) : null}
        <textarea
          ref={textareaRef}
          id="transcription"
          value={editedText}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="block h-full min-h-[420px] w-full resize-none rounded-md border border-border/80 bg-card px-3 py-3 font-mono text-[13px] leading-6 text-foreground transition-shadow placeholder:text-muted-foreground/70 focus:border-amber-400/70 focus:outline-none focus:ring-4 focus:ring-amber-300/30"
        />
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">
        <span className="font-mono tabular-nums">
          {characterCount} ch
        </span>
        <span className="truncate font-mono">
          {transcription.model} · v{transcription.promptVersion}
        </span>
      </footer>
    </aside>
  );
}

interface BottomBarProps {
  onDownload: () => void;
  onShare: () => void;
  onFullscreen: () => void;
  leftOpen: boolean;
  rightOpen: boolean;
  onToggleLeft: () => void;
  onToggleRight: () => void;
  documentId: string;
  pageIndicator: string;
}

function BottomBar({
  onDownload,
  onShare,
  onFullscreen,
  leftOpen,
  rightOpen,
  onToggleLeft,
  onToggleRight,
  documentId,
  pageIndicator,
}: BottomBarProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-[oklch(0.18_0.005_95)] px-3 py-2 text-[12px] text-white/80">
      <div className="flex items-center gap-1.5">
        <BottomIconButton ariaLabel="Download source" onClick={onDownload}>
          <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
        </BottomIconButton>
        <BottomIconButton ariaLabel="Share or embed link" onClick={onShare}>
          <Share2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </BottomIconButton>
      </div>

      <div className="hidden items-center gap-2 sm:flex">
        <span className="font-mono text-[11px] text-white/55">
          {documentId}
        </span>
        <span className="h-3 w-px bg-white/15" aria-hidden="true" />
        <span className="font-mono tabular-nums text-white/80">{pageIndicator}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <BottomIconButton
          ariaLabel={leftOpen ? "Hide contents" : "Show contents"}
          onClick={onToggleLeft}
          active={leftOpen}
        >
          <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
        </BottomIconButton>
        <BottomIconButton
          ariaLabel={rightOpen ? "Hide transcription" : "Show transcription"}
          onClick={onToggleRight}
          active={rightOpen}
        >
          <PanelRight className="h-3.5 w-3.5" strokeWidth={1.8} />
        </BottomIconButton>
        <BottomIconButton ariaLabel="Toggle fullscreen" onClick={onFullscreen}>
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
        </BottomIconButton>
      </div>
    </div>
  );
}

function BottomIconButton({
  children,
  onClick,
  ariaLabel,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={active}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition-colors",
        "hover:bg-white/15 hover:text-white",
        active ? "bg-white/20 text-white" : "",
      )}
    >
      {children}
    </button>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
