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

export const ACCEPT_ATTR = [
  ...ACCEPTED_UPLOAD_MIME_TYPES,
  ...ACCEPTED_UPLOAD_EXTENSIONS,
].join(",");

