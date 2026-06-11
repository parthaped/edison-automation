"use client";

import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseIiifManifest } from "@/lib/iiif/manifest";

interface IiifViewerProps {
  manifestUrl: string;
  thumbnailUrl?: string | null;
  edisonDigitalUrl?: string;
  initialPage?: number;
  title?: string;
}

function getProxiedManifestUrl(manifestUrl: string): string {
  return `/api/iiif/manifest?url=${encodeURIComponent(manifestUrl)}`;
}

export function IiifViewer({
  manifestUrl,
  thumbnailUrl,
  edisonDigitalUrl,
  initialPage = 0,
  title = "Document viewer",
}: IiifViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [pageIndex, setPageIndex] = useState(initialPage);
  const [pageCount, setPageCount] = useState(1);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initViewer() {
      setStatus("loading");
      setErrorMessage(null);

      try {
        const response = await fetch(getProxiedManifestUrl(manifestUrl));
        if (!response.ok) {
          throw new Error(`Manifest request failed (${response.status}).`);
        }

        const manifest = await response.json();
        const pages = parseIiifManifest(manifest);
        if (pages.length === 0) {
          throw new Error("No page images were found in the IIIF manifest.");
        }

        const OpenSeadragon = (await import("openseadragon")).default;
        if (cancelled || !containerRef.current) {
          return;
        }

        if (viewerRef.current) {
          viewerRef.current.destroy();
          viewerRef.current = null;
        }

        const tileSources = pages.map((page) => ({
          type: "image",
          url: page.url,
          buildPyramid: true,
          crossOriginPolicy: "Anonymous",
        }));

        const viewer = OpenSeadragon({
          element: containerRef.current,
          tileSources: tileSources as OpenSeadragon.Options["tileSources"],
          sequenceMode: true,
          initialPage: Math.min(Math.max(0, initialPage), pages.length - 1),
          showNavigationControl: false,
          showSequenceControl: false,
          showFullPageControl: false,
          prefixUrl: "https://openseadragon.github.io/openseadragon/images/",
          animationTime: 0.4,
          blendTime: 0.1,
          constrainDuringPan: true,
          maxZoomPixelRatio: 2,
          visibilityRatio: 1,
          minZoomImageRatio: 0.9,
          defaultZoomLevel: 0,
          homeFillsViewer: true,
          crossOriginPolicy: "Anonymous",
        });

        viewerRef.current = viewer;

        viewer.addHandler("open", () => {
          if (cancelled) {
            return;
          }
          viewer.viewport?.goHome(true);
          setPageCount(pages.length);
          setPageIndex(viewer.currentPage?.() ?? 0);
          setStatus("ready");
        });

        viewer.addHandler("page", (event: { page?: number }) => {
          if (typeof event.page === "number") {
            setPageIndex(event.page);
          }
        });

        viewer.addHandler("open-failed", (event: { message?: string }) => {
          if (!cancelled) {
            setErrorMessage(event.message ?? "Unable to open document pages.");
            setStatus("error");
          }
        });

        viewer.addHandler("resize", () => {
          viewer.viewport?.goHome(true);
        });
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error ? error.message : "Unable to load the IIIF viewer.",
          );
          setStatus("error");
        }
      }
    }

    void initViewer();

    return () => {
      cancelled = true;
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [manifestUrl, initialPage]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || status !== "ready") {
      return;
    }

    const observer = new ResizeObserver(() => {
      const viewer = viewerRef.current;
      if (!viewer) {
        return;
      }
      viewer.forceRedraw?.();
      viewer.viewport?.goHome(true);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [status]);

  function goToPage(nextPage: number) {
    const viewer = viewerRef.current;
    if (!viewer || nextPage < 0 || nextPage >= pageCount) {
      return;
    }
    viewer.goToPage(nextPage);
    setPageIndex(nextPage);
  }

  function zoomBy(factor: number) {
    const viewer = viewerRef.current;
    if (!viewer?.viewport) {
      return;
    }
    viewer.viewport.zoomBy(factor);
    viewer.viewport.applyConstraints();
  }

  function resetView() {
    const viewer = viewerRef.current;
    if (!viewer?.viewport) {
      return;
    }
    viewer.viewport.goHome(true);
  }

  if (status === "error") {
    return (
      <div className="rounded-lg border border-border bg-muted/20 p-6 text-center">
        {thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnailUrl}
            alt=""
            className="mx-auto mb-4 max-h-64 rounded border border-border object-contain"
          />
        ) : null}
        <p className="text-sm text-muted-foreground">
          {errorMessage ??
            "The IIIF viewer could not load this document. You can still view it on Edison Digital."}
        </p>
        {edisonDigitalUrl ? (
          <Button
            className="mt-4"
            render={
              <a href={edisonDigitalUrl} target="_blank" rel="noopener noreferrer" />
            }
          >
            View on edisondigital.rutgers.edu
            <ExternalLink className="size-4" aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100svh-4.5rem)] min-h-[520px] w-full flex-col overflow-hidden bg-[#111]">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 px-4 py-2 text-white">
        <p className="text-xs font-medium uppercase tracking-wide text-white/70">{title}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            disabled={status !== "ready" || pageIndex <= 0}
            onClick={() => goToPage(pageIndex - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-16 text-center text-xs tabular-nums text-white/80">
            {status === "ready" ? `${pageIndex + 1} / ${pageCount}` : "…"}
          </span>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            disabled={status !== "ready" || pageIndex >= pageCount - 1}
            onClick={() => goToPage(pageIndex + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            disabled={status !== "ready"}
            onClick={() => zoomBy(1.4)}
            aria-label="Zoom in"
          >
            <ZoomIn className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            disabled={status !== "ready"}
            onClick={() => zoomBy(0.7)}
            aria-label="Zoom out"
          >
            <ZoomOut className="size-4" />
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="text-white hover:bg-white/10 hover:text-white"
            disabled={status !== "ready"}
            onClick={resetView}
            aria-label="Reset view"
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        {status === "loading" ? (
          <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-white/70">
            Loading document viewer…
          </div>
        ) : null}
        <div
          ref={containerRef}
          className="iiif-viewer-canvas absolute inset-0 h-full w-full"
        />
      </div>
    </div>
  );
}
