import { shouldUsePageBasedTranscription } from "./ingest-policy";
import type { ExtractionPlan } from "./extraction";
import type { PageImageUrl } from "./service";

export interface SourceBlobRef {
  url: string;
  name: string;
  size: number;
  contentType: string;
}

export interface PreparedForSourceDeletion {
  urls: PageImageUrl[];
  extractionPlan: ExtractionPlan;
  error?: string;
}

export function isSourceBlobDeletionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.EDISON_DELETE_SOURCE_BLOB?.trim().toLowerCase();
  return raw !== "false" && raw !== "0" && raw !== "no";
}

export function isDeletableSourceBlob(blob: SourceBlobRef): boolean {
  return blob.contentType.toLowerCase() === "application/pdf";
}

export function shouldDeleteSourceAfterRasterize(input: {
  blob: SourceBlobRef;
  prepared: PreparedForSourceDeletion;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!isSourceBlobDeletionEnabled(input.env)) return false;
  if (!isDeletableSourceBlob(input.blob)) return false;
  if (input.prepared.urls.length === 0) return false;
  if (input.prepared.error) return false;

  const pageCount = Math.max(1, input.prepared.extractionPlan.pageCount);
  return shouldUsePageBasedTranscription({
    mimeType: input.blob.contentType,
    fileSizeBytes: input.blob.size,
    pageCount,
    hasPageImages: input.prepared.urls.length > 0,
  });
}

export function shouldDeleteSourceAfterTranscribe(input: {
  blob: SourceBlobRef;
  prepared: PreparedForSourceDeletion;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!isSourceBlobDeletionEnabled(input.env)) return false;
  if (!isDeletableSourceBlob(input.blob)) return false;
  if (shouldDeleteSourceAfterRasterize(input)) return false;

  const pageCount = Math.max(1, input.prepared.extractionPlan.pageCount);
  const usesWholeFilePath = !shouldUsePageBasedTranscription({
    mimeType: input.blob.contentType,
    fileSizeBytes: input.blob.size,
    pageCount,
    hasPageImages: input.prepared.urls.length > 0,
  });

  if (!usesWholeFilePath) return false;
  if (input.prepared.urls.length === 0 && input.prepared.error) return false;
  return true;
}
