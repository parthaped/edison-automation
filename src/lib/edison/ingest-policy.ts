import { isOcrQueueEnabled } from "./ocr-queue-config";

/** Pages per vision LLM call when using page-chunked transcription. */
export const DEFAULT_PAGE_CHUNK_SIZE = 8;

/** Files at or above this size use page-chunked transcription (when PDF). */
export const LARGE_FILE_BYTES = 50 * 1024 * 1024;

/** PDFs with at least this many pages use page-chunked transcription. */
export const LARGE_PAGE_COUNT = 15;

/** Default parallel page-chunk transcribe steps within one file (1 avoids Gemini rate-limit bursts). */
export const DEFAULT_PAGE_CHUNK_CONCURRENCY = 1;

/** Pause between chunk step batches to reduce rate-limit errors (ms). */
export const DEFAULT_PAGE_CHUNK_BATCH_DELAY_MS = 3000;

export interface PageRange {
  startPage: number;
  endPage: number;
}

export function getPageChunkSize(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.EDISON_PAGE_CHUNK_SIZE);
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_PAGE_CHUNK_SIZE;
}

export function getPageChunkConcurrency(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.EDISON_PAGE_CHUNK_CONCURRENCY);
  return Number.isFinite(raw) && raw >= 1
    ? Math.floor(raw)
    : DEFAULT_PAGE_CHUNK_CONCURRENCY;
}

export function getPageChunkBatchDelayMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.EDISON_PAGE_CHUNK_BATCH_DELAY_MS);
  return Number.isFinite(raw) && raw >= 0
    ? Math.floor(raw)
    : DEFAULT_PAGE_CHUNK_BATCH_DELAY_MS;
}

export function shouldUsePageChunkedTranscription(input: {
  mimeType: string;
  fileSizeBytes: number;
  pageCount: number;
}): boolean {
  const mime = input.mimeType.toLowerCase();
  if (mime !== "application/pdf") return false;
  return (
    input.fileSizeBytes >= LARGE_FILE_BYTES || input.pageCount >= LARGE_PAGE_COUNT
  );
}

/** Route through rasterized page images (OCR queue or chunked Gemini/local). */
export function shouldUsePageBasedTranscription(input: {
  mimeType: string;
  fileSizeBytes: number;
  pageCount: number;
  hasPageImages: boolean;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!input.hasPageImages) return false;
  const env = input.env ?? process.env;
  if (isOcrQueueEnabled(env)) return true;
  return shouldUsePageChunkedTranscription({
    mimeType: input.mimeType,
    fileSizeBytes: input.fileSizeBytes,
    pageCount: input.pageCount,
  });
}

/** Splits 1..pageCount into contiguous inclusive page ranges. */
export function partitionPageRanges(
  pageCount: number,
  chunkSize: number,
): PageRange[] {
  if (pageCount < 1 || chunkSize < 1) return [];
  const ranges: PageRange[] = [];
  for (let start = 1; start <= pageCount; start += chunkSize) {
    ranges.push({
      startPage: start,
      endPage: Math.min(start + chunkSize - 1, pageCount),
    });
  }
  return ranges;
}

/** Lower file-level concurrency when ingesting very large sources. */
export function effectiveFileConcurrency(
  blobs: Array<{ size: number }>,
  baseConcurrency: number,
): number {
  const hasVeryLarge = blobs.some((blob) => blob.size >= LARGE_FILE_BYTES);
  if (hasVeryLarge) return 1;
  return baseConcurrency;
}
