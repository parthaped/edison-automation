import { describe, expect, it } from "vitest";
import {
  BLOB_MULTIPART_THRESHOLD_BYTES,
  inferUploadContentType,
  MAX_UPLOAD_BATCH_BYTES,
  partitionFilesIntoUploadBatches,
  shouldUseBlobMultipartUpload,
  UploadBatchPartitionError,
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

  it("groups whole files into upload batches without splitting a file", () => {
    const files = [
      { name: "a.pdf", size: 200 * 1024 * 1024 },
      { name: "b.pdf", size: 200 * 1024 * 1024 },
      { name: "c.pdf", size: 150 * 1024 * 1024 },
    ];

    expect(partitionFilesIntoUploadBatches(files)).toEqual([
      [files[0], files[1]],
      [files[2]],
    ]);
  });

  it("keeps an oversized single file out of batch splitting", () => {
    const file = { name: "huge.pdf", size: MAX_UPLOAD_BATCH_BYTES + 1 };
    expect(() => partitionFilesIntoUploadBatches([file])).toThrow(
      UploadBatchPartitionError,
    );
  });
});
