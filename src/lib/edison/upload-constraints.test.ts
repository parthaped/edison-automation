import { describe, expect, it } from "vitest";
import {
  BLOB_MULTIPART_THRESHOLD_BYTES,
  inferUploadContentType,
  shouldUseBlobMultipartUpload,
} from "./upload-constraints";

describe("upload constraints", () => {
  it("infers jpeg content type from file extension", () => {
    expect(inferUploadContentType("2019-06-27-12-44-53_002.jpg")).toBe(
      "image/jpeg",
    );
  });

  it("uses multipart uploads only for large files", () => {
    expect(shouldUseBlobMultipartUpload(4.8 * 1024 * 1024)).toBe(false);
    expect(shouldUseBlobMultipartUpload(BLOB_MULTIPART_THRESHOLD_BYTES)).toBe(
      true,
    );
  });
});
