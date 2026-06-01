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
import { motion, type Transition } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const motionSpring: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 28,
  mass: 0.6,
};
import { cn } from "@/lib/utils";
import type { DocumentPackage, PageImage, TranscriptionRun } from "@/lib/edison/types";

export interface DocumentViewerProps {
  document: DocumentPackage;
  transcription: TranscriptionRun;
  initialPage?: number;
  className?: string;
}

type ViewLayout = "single" | "two-page" | "grid";

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;

function clampPageIndex(index: number, pageCount: number): number {
  if (pageCount <= 0) return 0;
  return Math.min(Math.max(index, 0), pageCount - 1);
}

export function DocumentViewer({
  document,
  transcription,
  initialPage = 0,
  className,
}: DocumentViewerProps) {
  const pages = document.pages;
  const pageCount = pages.length;
  const hasPages = pageCount > 0;

  const [activePage, setActivePage] = useState(() =>
    clampPageIndex(initialPage, pageCount),
  );
  const [pageInput, setPageInput] = useState(() =>
    String(clampPageIndex(initialPage, pageCount) + 1),
  );
  const [viewLayout, setViewLayout] = useState<ViewLayout>("single");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editedText, setEditedText] = useState(transcription.diplomaticText);
  const [savedText, setSavedText] = useState(transcription.diplomaticText);
  const [saving, setSaving] = useState(false);
  const [lastTranscriptionId, setLastTranscriptionId] = useState(transcription.id);
  const [lastDocumentId, setLastDocumentId] = useState(document.documentId);
  const [lastActivePage, setLastActivePage] = useState(activePage);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(
    null,
  );
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  if (lastTranscriptionId !== transcription.id) {
    setLastTranscriptionId(transcription.id);
    setEditedText(transcription.diplomaticText);
    setSavedText(transcription.diplomaticText);
  }

  if (lastDocumentId !== document.documentId) {
    setLastDocumentId(document.documentId);
    const nextPage = clampPageIndex(initialPage, pageCount);
    setActivePage(nextPage);
    setLastActivePage(nextPage);
    setPageInput(String(nextPage + 1));
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }

  if (lastActivePage !== activePage) {
    setLastActivePage(activePage);
    setPageInput(String(activePage + 1));
    setPan({ x: 0, y: 0 });
  }

  useEffect(() => {
    if (!textareaRef.current || pageCount <= 1) {
      return;
    }
    const ta = textareaRef.current;
    const ratio = activePage / Math.max(1, pageCount - 1);
    const targetTop = ratio * Math.max(0, ta.scrollHeight - ta.clientHeight);
    if (typeof ta.scrollTo === "function") {
      ta.scrollTo({ top: targetTop, behavior: "smooth" });
    } else {
      ta.scrollTop = targetTop;
    }
  }, [activePage, pageCount, editedText.length]);

  // Settings are inapplicable in grid mode (no zoom/rotate). Derive the
  // effective open-state during render instead of clearing it via an effect,
  // which would trigger a cascading re-render.
  const settingsActuallyOpen = settingsOpen && viewLayout !== "grid";

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

  const adjustZoom = useCallback((delta: number) => {
    setZoom((current) => clamp(round2(current + delta), ZOOM_MIN, ZOOM_MAX));
  }, []);

  const setZoomExact = useCallback((value: number) => {
    setZoom(clamp(round2(value), ZOOM_MIN, ZOOM_MAX));
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  const rotate90 = useCallback(() => {
    setRotation((current) => (current + 90) % 360);
  }, []);

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

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    function handleWheel(event: WheelEvent) {
      if (viewLayout === "grid") return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      adjustZoom(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
    }

    stage.addEventListener("wheel", handleWheel, { passive: false });
    return () => stage.removeEventListener("wheel", handleWheel);
  }, [adjustZoom, viewLayout]);

  function handleStageDoubleClick() {
    if (zoom > 1) {
      resetView();
    } else {
      setZoomExact(2);
    }
  }

  function handleTextareaChange(event: React.ChangeEvent<HTMLTextAreaElement>) {
    setEditedText(event.target.value);
  }

  const dirty = editedText !== savedText;

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      const response = await fetch(
        `/api/documents/${encodeURIComponent(document.documentId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ diplomaticText: editedText }),
        },
      );
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(data?.error ?? `Save failed (${response.status}).`);
      }
      setSavedText(editedText);
      toast.success("Transcription saved.");
    } catch (error) {
      toast.error("Could not save transcription", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
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
    const href = `${window.location.origin}/viewer/${document.documentId}?${params.toString()}`;
    try {
      await navigator.clipboard.writeText(href);
      toast.success("Share link copied", { description: href });
    } catch {
      toast.message("Share link", { description: href });
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

  const currentPage = hasPages ? pages[activePage] : undefined;
  const downloadUrl =
    currentPage?.originalUrl ?? pages.find((page) => page.originalUrl)?.originalUrl;

  function handleDownload() {
    if (!downloadUrl) return;
    const anchor = window.document.createElement("a");
    anchor.href = downloadUrl;
    anchor.download = document.sourceFile.name;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.click();
  }

  const adjacentPage =
    viewLayout === "two-page" && hasPages ? pages[activePage + 1] : undefined;

  const characterCount = editedText.length;
  const uncertain = transcription.uncertainReadings ?? [];

  return (
    <section
      ref={containerRef}
      aria-label="Source and transcription viewer"
      className={cn(
        "edison-viewer relative flex min-h-[560px] flex-col overflow-hidden border border-border bg-card",
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
        settingsOpen={settingsActuallyOpen}
        onToggleSettings={() => setSettingsOpen((value) => !value)}
        zoom={zoom}
        zoomDisabled={viewLayout === "grid"}
        onZoomIn={() => adjustZoom(ZOOM_STEP)}
        onZoomOut={() => adjustZoom(-ZOOM_STEP)}
        onRotate={rotate90}
        onReset={resetView}
        title={document.title}
      />

      <div
        className={cn(
          "grid min-h-0 flex-1 gap-px overflow-y-auto bg-border lg:overflow-hidden",
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
          settingsOpen={settingsActuallyOpen}
          onCloseSettings={() => setSettingsOpen(false)}
          onZoomSlider={setZoomExact}
          onRotate={rotate90}
          onReset={resetView}
          onPointerDown={handleStagePointerDown}
          onPointerMove={handleStagePointerMove}
          onPointerUp={handleStagePointerUp}
          onPointerCancel={handleStagePointerUp}
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
            onClose={() => setRightOpen(false)}
            onSave={handleSave}
            saving={saving}
            dirty={dirty}
          />
        ) : null}
      </div>

      <BottomBar
        onDownload={handleDownload}
        downloadDisabled={!downloadUrl}
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
  zoomDisabled?: boolean;
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
  zoomDisabled = false,
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
      className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-3 py-2 text-slate-200"
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
          className="flex items-center gap-1.5 rounded-sm bg-white/10 px-1.5 py-1 text-[12px]"
        >
          <span className="ml-0.5 text-[11px] uppercase tracking-wide text-white/70">
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
            className="h-6 w-12 rounded-sm bg-white/10 px-1 text-center font-mono text-[12px] text-white outline-none ring-1 ring-inset ring-white/15 focus:ring-primary disabled:opacity-50"
          />
          <span className="text-[11px] text-white/70">of {pageCount || 0}</span>
          <button
            type="submit"
            disabled={pageCount === 0}
            className="ml-1 inline-flex h-6 items-center justify-center rounded-sm bg-primary px-2 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-50"
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

        <ToolbarIconButton
          ariaLabel="Zoom out"
          title={zoomDisabled ? "Switch to single-page view to zoom" : undefined}
          onClick={onZoomOut}
          disabled={zoomDisabled || zoom <= ZOOM_MIN}
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
        <span className="font-mono text-[11px] tabular-nums text-white/70">
          {Math.round(zoom * 100)}%
        </span>
        <ToolbarIconButton
          ariaLabel="Zoom in"
          title={zoomDisabled ? "Switch to single-page view to zoom" : undefined}
          onClick={onZoomIn}
          disabled={zoomDisabled || zoom >= ZOOM_MAX}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
        <ToolbarIconButton
          ariaLabel="Rotate 90 degrees"
          title={zoomDisabled ? "Switch to single-page view to zoom" : undefined}
          onClick={onRotate}
          disabled={zoomDisabled}
        >
          <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
        </ToolbarIconButton>
        <ToolbarIconButton
          ariaLabel="Reset view"
          title={zoomDisabled ? "Switch to single-page view to zoom" : undefined}
          onClick={onReset}
          disabled={zoomDisabled}
        >
          <span className="font-mono text-[10px] font-semibold uppercase tracking-wide">
            1:1
          </span>
        </ToolbarIconButton>
        <ToolbarIconButton
          ariaLabel="Viewer settings"
          title={zoomDisabled ? "Switch to single-page view to zoom" : undefined}
          onClick={onToggleSettings}
          active={settingsOpen}
          disabled={zoomDisabled}
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
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ariaLabel: string;
  active?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
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
      className="flex h-full min-h-0 flex-col bg-muted/60"
    >
      <div className="flex items-center justify-between border-b border-border bg-card px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
                    "block w-full rounded-sm border px-2.5 py-1.5 text-left text-[12px] transition-colors",
                    index === activePage
                      ? "border-primary/40 bg-primary/5 text-foreground"
                      : "border-transparent bg-card hover:border-border hover:bg-muted/60",
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
        "group block w-full overflow-hidden rounded-sm border bg-card text-left transition-all",
        active
          ? "border-primary ring-1 ring-primary"
          : "border-border hover:border-slate-400",
      )}
    >
      <div className="relative aspect-[3/4] w-full bg-slate-100">
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
    <div className="flex h-full w-full flex-col gap-1.5 bg-slate-100 p-2.5">
      <span className="h-1 w-2/3 rounded-full bg-slate-400/40" />
      <span className="h-1 w-full rounded-full bg-slate-400/30" />
      <span className="h-1 w-5/6 rounded-full bg-slate-400/30" />
      <span className="h-1 w-4/6 rounded-full bg-slate-400/30" />
      <span className="mt-auto h-1 w-1/2 rounded-full bg-slate-400/40" />
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
      onDoubleClick={onDoubleClick}
      style={stageStyle}
      className={cn(
        "relative flex h-full min-h-[280px] min-w-0 items-center justify-center overflow-hidden bg-slate-950 p-6 sm:p-10",
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={motionSpring}
          className="flex h-full max-h-full w-full items-center justify-center"
        >
          <div
            data-testid="viewer-transform-layer"
            className="flex h-full max-h-full w-full items-center justify-center gap-6"
            style={{ transform, transformOrigin: "center center" }}
          >
            <div className="flex h-full min-w-0 flex-1 items-center justify-center">
              <PageRender page={currentPage} />
            </div>
            {viewLayout === "two-page" && adjacentPage ? (
              <div className="flex h-full min-w-0 flex-1 items-center justify-center">
                <PageRender page={adjacentPage} />
              </div>
            ) : null}
          </div>
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
    <div className="grid max-h-full w-full max-w-3xl grid-cols-2 gap-4 overflow-y-auto py-1 sm:grid-cols-3">
      {pages.map((page, index) => (
        <button
          key={page.id}
          type="button"
          onClick={() => onSelect(index)}
          aria-label={`Go to page ${page.sourcePage}`}
          className={cn(
            "group overflow-hidden rounded-sm border bg-card text-left transition-all",
            index === activePage
              ? "border-primary ring-2 ring-primary/50"
              : "border-white/10 hover:border-white/30",
          )}
        >
          <div className="relative aspect-[3/4] w-full bg-slate-100">
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
        className="max-h-full w-auto max-w-full select-none rounded-md object-contain shadow-[0_20px_60px_-30px_rgba(0,0,0,0.6)]"
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
      <header className="mb-6 flex items-center justify-between text-[10px] uppercase tracking-wide text-[oklch(0.45_0.04_70)]">
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
      <footer className="mt-10 flex items-center justify-between text-[10px] uppercase tracking-wide text-[oklch(0.5_0.04_70)]">
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
        "pointer-events-none absolute bottom-3 left-3 max-w-[260px] rounded-sm border border-white/10 bg-slate-950/70 px-3 py-2 text-[11px] leading-snug text-white/85 backdrop-blur",
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/65">
        Attribution
      </p>
      <p className="mt-0.5">
        Thomas A. Edison Papers, Rutgers University.
        <br />
        Terms of use: <span className="font-medium text-white">CC-BY-NC 4.0</span>
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
      className="absolute right-3 top-3 z-10 w-60 rounded-sm border border-border bg-card p-3 text-sm shadow-[0_8px_24px_-12px_rgba(15,23,42,0.25)]"
    >
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
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
          className="mt-1.5 block w-full accent-[color:var(--primary)]"
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
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  dirty: boolean;
}

function TranscriptionPane({
  textareaRef,
  editedText,
  characterCount,
  transcription,
  uncertain,
  onChange,
  onSelectUncertain,
  onClose,
  onSave,
  saving,
  dirty,
}: TranscriptionPaneProps) {
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "s") {
      event.preventDefault();
      onSave();
    }
  }
  return (
    <aside
      aria-label="Transcription editor"
      className="flex h-full min-h-0 flex-col bg-card"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            More information
          </p>
          <label
            htmlFor="transcription"
            className="mt-0.5 block truncate text-[15px] font-semibold text-foreground"
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
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-amber-50/40 px-4 py-2.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-800">
            Uncertain ({uncertain.length})
          </span>
          {uncertain.map((token, index) => (
            <button
              key={`${token}-${index}`}
              type="button"
              onClick={() => onSelectUncertain(token)}
              className="inline-flex items-center rounded-sm border border-amber-300/80 bg-white px-2 py-0.5 font-mono text-[11px] text-amber-900 transition-colors hover:bg-amber-50"
            >
              {token}
            </button>
          ))}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 px-4 py-3">
        <textarea
          ref={textareaRef}
          id="transcription"
          value={editedText}
          onChange={onChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          className="block h-full min-h-[160px] w-full resize-none rounded-sm border border-border bg-card px-3 py-3 font-mono text-[13px] leading-6 text-foreground transition-shadow placeholder:text-muted-foreground/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </div>

      <footer className="flex items-center justify-between gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
        <span className="font-mono tabular-nums">
          {characterCount} ch
          {dirty ? <span className="ml-1 text-amber-600">· unsaved</span> : null}
        </span>
        <div className="flex items-center gap-2">
          <span className="hidden truncate font-mono sm:inline">
            {transcription.model} · v{transcription.promptVersion}
          </span>
          <button
            type="button"
            onClick={onSave}
            disabled={saving || !dirty}
            className="inline-flex h-7 items-center justify-center rounded-md bg-primary px-3 text-[12px] font-semibold text-primary-foreground transition-colors hover:bg-primary/85 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </footer>
    </aside>
  );
}

interface BottomBarProps {
  onDownload: () => void;
  downloadDisabled?: boolean;
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
  downloadDisabled = false,
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
    <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-800 bg-slate-900 px-3 py-2 text-[12px] text-white/80">
      <div className="flex items-center gap-1.5">
        <BottomIconButton
          ariaLabel={
            downloadDisabled
              ? "Download unavailable — source image not yet attached"
              : "Download source"
          }
          title={
            downloadDisabled
              ? "Source file is not yet attached for download"
              : undefined
          }
          onClick={onDownload}
          disabled={downloadDisabled}
        >
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
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ariaLabel: string;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={active}
      title={title}
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded-md text-white/80 transition-colors",
        "hover:bg-white/15 hover:text-white",
        active ? "bg-white/20 text-white" : "",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
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
