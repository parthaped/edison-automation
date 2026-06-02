import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  rasterizePdfPages,
  type RasterizePdfOptions,
  type RasterizedPage,
} from "./rasterize-pdf";

const execFileAsync = promisify(execFile);

export type RasterizeBackend = "pdfjs" | "pdftoppm";

export interface RasterizePdfResult {
  pages: RasterizedPage[];
  backend: RasterizeBackend;
}

/**
 * Rasterization backend selection.
 *
 * | Backend   | When used | Tradeoffs |
 * |-----------|-----------|-----------|
 * | `pdfjs`   | Default in serverless (no extra deps) | Pure Node; sequential pages; higher memory on huge PDFs |
 * | `pdftoppm`| When `EDISON_PDFTOPPM_PATH` is set (Poppler) | Much faster on large scans; needs binary on the host or Sandbox |
 *
 * Vercel Sandbox + `pdftoppm` is the production target in docs/architecture.md.
 * This module keeps pdfjs as the portable fallback until Sandbox wiring lands.
 */
export function getRasterizeBackend(
  env: NodeJS.ProcessEnv = process.env,
): RasterizeBackend {
  return env.EDISON_PDFTOPPM_PATH?.trim() ? "pdftoppm" : "pdfjs";
}

export async function rasterizePdfWithProvider(
  bytes: Uint8Array,
  options: RasterizePdfOptions = {},
): Promise<RasterizePdfResult> {
  const backend = getRasterizeBackend();
  if (backend === "pdftoppm") {
    try {
      const pages = await rasterizeWithPdftoppm(bytes, options);
      return { pages, backend };
    } catch (error) {
      console.warn("[rasterize-provider] pdftoppm failed; falling back to pdfjs", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const pages = await rasterizePdfPages(bytes, options);
  return { pages, backend: "pdfjs" };
}

async function rasterizeWithPdftoppm(
  bytes: Uint8Array,
  options: RasterizePdfOptions,
): Promise<RasterizedPage[]> {
  const pdftoppmPath = process.env.EDISON_PDFTOPPM_PATH?.trim();
  if (!pdftoppmPath) {
    throw new Error("EDISON_PDFTOPPM_PATH is not configured.");
  }

  const scale = options.scale ?? 2;
  const quality = options.quality ?? 85;
  // pdftoppm -jpeg -jpegopt quality=N -scale-to-x W uses width in pixels; 2× letter ≈ 1700px
  const targetWidth = Math.round(612 * scale);
  const tempDir = await mkdtemp(join(tmpdir(), "edison-pdftoppm-"));
  const inputPath = join(tempDir, "input.pdf");
  const outputPrefix = join(tempDir, "page");

  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(inputPath, bytes);

    await execFileAsync(
      pdftoppmPath,
      [
        "-jpeg",
        "-jpegopt",
        `quality=${quality}`,
        "-scale-to-x",
        String(targetWidth),
        inputPath,
        outputPrefix,
      ],
      { maxBuffer: 64 * 1024 * 1024 },
    );

    const files = (await readdir(tempDir))
      .filter((name) => name.startsWith("page-") && name.endsWith(".jpg"))
      .sort();

    const pages: RasterizedPage[] = [];
    for (const [index, fileName] of files.entries()) {
      options.signal?.throwIfAborted?.();
      const jpg = await readFile(join(tempDir, fileName));
      pages.push({
        pageIndex: index,
        jpg: new Uint8Array(jpg),
        width: targetWidth,
        height: Math.round(targetWidth * 1.294),
      });
    }
    return pages;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
