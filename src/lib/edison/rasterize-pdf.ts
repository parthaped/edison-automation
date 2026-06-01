// PDF rasterization for the Edison ingest pipeline.
//
// pdfjs-dist 5.x ships built-in Node support: when it detects a Node runtime
// it dynamically requires "@napi-rs/canvas" and uses a `NodeCanvasFactory` for
// rendering. We import "@napi-rs/canvas" directly to allocate the canvas
// ourselves so we can encode the rendered surface to JPEG without going
// through any DOM API. Both packages are listed in `serverExternalPackages`
// in next.config.ts so the bundler doesn't try to inline the native binding.

import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

// Render at 2x the PDF's native scale by default. That is enough to make
// handwriting and small marginalia legible in the viewer without bloating blob
// storage. Quality 0.85 keeps the JPEG small while staying visually clean.
const DEFAULT_SCALE = 2;
const DEFAULT_JPEG_QUALITY = 85;

export interface RasterizedPage {
  pageIndex: number;
  jpg: Uint8Array;
  width: number;
  height: number;
}

export interface RasterizePdfOptions {
  scale?: number;
  // 0..100 quality for the encoder. The @napi-rs/canvas API uses an integer
  // quality, not the 0..1 fraction the browser canvas API accepts.
  quality?: number;
  signal?: AbortSignal;
}

export async function rasterizePdfPages(
  bytes: Uint8Array,
  options: RasterizePdfOptions = {},
): Promise<RasterizedPage[]> {
  const scale = options.scale ?? DEFAULT_SCALE;
  const quality = options.quality ?? DEFAULT_JPEG_QUALITY;

  // pdfjs-dist consumes the buffer it is given, so pass a fresh copy. The
  // ingest workflow may reuse the source bytes elsewhere.
  const data = new Uint8Array(bytes);
  const loadingTask = getDocument({
    data,
    // Disable system-font lookup: serverless runtimes generally don't have
    // matching fonts installed, and pdfjs's built-in font fallback renders
    // unknown glyphs more reliably than failing on a missing system font.
    useSystemFonts: false,
  });

  const pdf = await loadingTask.promise;
  try {
    const pages: RasterizedPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      options.signal?.throwIfAborted?.();

      const page = await pdf.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);

        const canvas = createCanvas(width, height);
        // pdfjs's modern render API takes the canvas directly (it allocates
        // the 2D context itself). The @napi-rs/canvas Canvas mirrors the
        // HTMLCanvasElement shape pdfjs uses, so we cast through unknown.
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          viewport,
        }).promise;

        const jpg = await canvas.encode("jpeg", quality);
        pages.push({
          pageIndex: pageNumber - 1,
          jpg: new Uint8Array(jpg),
          width,
          height,
        });
      } finally {
        page.cleanup();
      }
    }
    return pages;
  } finally {
    await pdf.cleanup();
    await pdf.destroy();
  }
}
