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

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
export const DIRECT_INGEST_MAX_BYTES = 4 * 1024 * 1024;
// Match @vercel/blob multipart part size; smaller files use a single PUT upload.
export const BLOB_MULTIPART_THRESHOLD_BYTES = 8 * 1024 * 1024;
export const BLOB_UPLOAD_TIMEOUT_MS = 120_000;

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

export const ACCEPT_ATTR = [
  ...ACCEPTED_UPLOAD_MIME_TYPES,
  ...ACCEPTED_UPLOAD_EXTENSIONS,
].join(",");

