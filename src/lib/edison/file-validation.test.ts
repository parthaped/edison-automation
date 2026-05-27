import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, validateSourceFile } from "./file-validation";

describe("validateSourceFile", () => {
  it("accepts PDF content by magic bytes", () => {
    const result = validateSourceFile({
      name: "scan.bin",
      size: 12,
      mimeType: "application/octet-stream",
      bytes: new TextEncoder().encode("%PDF-1.7"),
    });

    expect(result.accepted).toBe(true);
    expect(result.kind).toBe("pdf");
  });

  it("warns on misleading extensions", () => {
    const result = validateSourceFile({
      name: "scan.pdf",
      size: 12,
      mimeType: "application/pdf",
      bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]),
    });

    expect(result.accepted).toBe(true);
    expect(result.kind).toBe("jpeg");
    expect(result.warnings[0]).toContain("extension suggests pdf");
  });

  it("blocks empty files", () => {
    const result = validateSourceFile({
      name: "empty.pdf",
      size: 0,
      mimeType: "application/pdf",
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("empty");
  });

  it("blocks oversized files", () => {
    const result = validateSourceFile({
      name: "huge.tif",
      size: MAX_UPLOAD_BYTES + 1,
      mimeType: "image/tiff",
    });

    expect(result.accepted).toBe(false);
    expect(result.reason).toContain("exceeds");
  });

  it("accepts multi-page TIFF candidates by signature", () => {
    const result = validateSourceFile({
      name: "ledger.tiff",
      size: 1024,
      mimeType: "image/tiff",
      bytes: Uint8Array.from([0x49, 0x49, 0x2a, 0x00]),
    });

    expect(result.accepted).toBe(true);
    expect(result.kind).toBe("tiff");
  });
});
