export const TRANSCRIBABLE_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
] as const;

export const TRANSCRIBABLE_EXTENSIONS = [
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
] as const;

export const ACCEPTED_UPLOAD_MIME_TYPES = TRANSCRIBABLE_MIME_TYPES;
export const ACCEPTED_UPLOAD_EXTENSIONS = TRANSCRIBABLE_EXTENSIONS;

// Per-file upload cap. A single PDF or image is always uploaded and ingested
// as one atomic unit — we never split a source file across batches or at
// arbitrary byte boundaries. Vercel Blob "multipart" is transport-only; the
// stored blob is identical to the original file. Sub-document boundaries
// inside a PDF are detected during transcription on the complete file.
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
// Maximum total size per ingest batch when uploading many files at once.
// Files are grouped into whole-file batches; one file is never divided.
export const MAX_UPLOAD_BATCH_BYTES = MAX_UPLOAD_BYTES;
export const DIRECT_INGEST_MAX_BYTES = 4 * 1024 * 1024;
// Match @vercel/blob multipart part size; smaller files use a single PUT upload.
export const BLOB_MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
// Give the @vercel/blob client enough budget to ride out transient retries
// (it uses async-retry internally with exponential backoff). Smaller values
// caused legitimate large-file uploads on slow connections to be aborted by
// our wrapper before the underlying retry finished.
export const BLOB_UPLOAD_TIMEOUT_MS = 300_000;

const EXTENSION_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export function inferUploadContentType(
  fileName: string,
  mimeType?: string,
): string {
  const normalized = mimeType?.toLowerCase().trim();
  if (normalized && normalized !== "application/octet-stream") {
    return normalized;
  }
  const extension = fileName.toLowerCase().split(".").at(-1) ?? "";
  return EXTENSION_TO_MIME[extension] ?? "application/octet-stream";
}

export function shouldUseBlobMultipartUpload(fileSize: number): boolean {
  return fileSize >= BLOB_MULTIPART_THRESHOLD_BYTES;
}

export class UploadBatchPartitionError extends Error {
  constructor(
    message: string,
    readonly fileName?: string,
  ) {
    super(message);
    this.name = "UploadBatchPartitionError";
  }
}

/** Groups files into upload batches without splitting any single file. */
export function partitionFilesIntoUploadBatches<T extends { size: number }>(
  files: T[],
  maxBatchBytes: number = MAX_UPLOAD_BATCH_BYTES,
): T[][] {
  if (maxBatchBytes <= 0) {
    throw new UploadBatchPartitionError("Upload batch size limit must be positive.");
  }

  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentBatchBytes = 0;

  for (const file of files) {
    if (file.size > maxBatchBytes) {
      const fileName =
        "name" in file && typeof file.name === "string" ? file.name : undefined;
      throw new UploadBatchPartitionError(
        fileName
          ? `${fileName} exceeds the per-file upload limit.`
          : "A selected file exceeds the per-file upload limit.",
        fileName,
      );
    }

    if (
      currentBatch.length > 0 &&
      currentBatchBytes + file.size > maxBatchBytes
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchBytes = 0;
    }

    currentBatch.push(file);
    currentBatchBytes += file.size;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}

export const ACCEPT_ATTR = [
  ...ACCEPTED_UPLOAD_MIME_TYPES,
  ...ACCEPTED_UPLOAD_EXTENSIONS,
].join(",");

