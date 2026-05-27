import type { SupportedFileKind, ValidationResult } from "./types";

export const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;

const EXTENSION_TO_KIND: Record<string, SupportedFileKind> = {
  pdf: "pdf",
  jpg: "jpeg",
  jpeg: "jpeg",
  png: "png",
  tif: "tiff",
  tiff: "tiff",
  webp: "webp",
  gif: "gif",
  docx: "docx",
  csv: "csv",
};

const MIME_TO_KIND: Record<string, SupportedFileKind> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/tiff": "tiff",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "text/csv": "csv",
  "application/csv": "csv",
};

export interface FileValidationInput {
  name: string;
  size: number;
  mimeType?: string;
  bytes?: Uint8Array;
}

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

export function detectKindFromMagic(bytes?: Uint8Array): SupportedFileKind | undefined {
  if (!bytes || bytes.length < 4) {
    return undefined;
  }

  const ascii = new TextDecoder("latin1").decode(bytes.slice(0, 12));
  const firstBytes = [...bytes.slice(0, 12)];

  if (ascii.startsWith("%PDF")) return "pdf";
  if (firstBytes[0] === 0xff && firstBytes[1] === 0xd8) return "jpeg";
  if (
    firstBytes[0] === 0x89 &&
    firstBytes[1] === 0x50 &&
    firstBytes[2] === 0x4e &&
    firstBytes[3] === 0x47
  ) {
    return "png";
  }
  if (ascii.startsWith("GIF87a") || ascii.startsWith("GIF89a")) return "gif";
  if (ascii.startsWith("II*\u0000") || ascii.startsWith("MM\u0000*")) return "tiff";
  if (ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WEBP") return "webp";
  if (firstBytes[0] === 0x50 && firstBytes[1] === 0x4b) return "docx";

  return undefined;
}

export function validateSourceFile(input: FileValidationInput): ValidationResult {
  const warnings: string[] = [];

  if (input.size <= 0) {
    return {
      accepted: false,
      reason: "The file is empty.",
      warnings,
    };
  }

  if (input.size > MAX_UPLOAD_BYTES) {
    return {
      accepted: false,
      reason: `The file exceeds the ${MAX_UPLOAD_BYTES} byte upload limit.`,
      warnings,
    };
  }

  const extensionKind = EXTENSION_TO_KIND[getExtension(input.name)];
  const mimeKind = input.mimeType ? MIME_TO_KIND[input.mimeType.toLowerCase()] : undefined;
  const magicKind = detectKindFromMagic(input.bytes);
  const kind = magicKind ?? mimeKind ?? extensionKind;

  if (!kind) {
    return {
      accepted: false,
      reason: "Unsupported file type. The original will be routed to manual review.",
      warnings,
    };
  }

  if (extensionKind && magicKind && extensionKind !== magicKind) {
    warnings.push(
      `The file extension suggests ${extensionKind}, but the content looks like ${magicKind}.`,
    );
  }

  if (mimeKind && magicKind && mimeKind !== magicKind) {
    warnings.push(
      `The MIME type suggests ${mimeKind}, but the content looks like ${magicKind}.`,
    );
  }

  return {
    accepted: true,
    kind,
    warnings,
  };
}
