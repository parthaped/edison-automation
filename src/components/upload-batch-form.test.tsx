import { upload } from "@vercel/blob/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadBatchForm } from "./upload-batch-form";
import { MAX_UPLOAD_BYTES } from "@/lib/edison/upload-constraints";
import type { ManualIngestJobSnapshot } from "@/lib/edison/manual-ingest-jobs";
import type { ManualIngestResult } from "@/lib/edison/service";

vi.mock("@vercel/blob/client", () => ({
  upload: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("UploadBatchForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks over-limit files before starting a Blob upload", async () => {
    const user = userEvent.setup();
    const file = new File(["x"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: MAX_UPLOAD_BYTES + 1 });

    render(<UploadBatchForm blobReady />);

    const input = screen.getByLabelText("Files");
    await user.upload(input, file);
    await screen.findByText(/large.pdf/);
    fireEvent.submit(input.closest("form")!);

    expect(upload).not.toHaveBeenCalled();
    expect(
      screen.getByText(/The per-file limit is 250.0 MB/),
    ).toBeInTheDocument();
  });

  it("uses single-part Blob upload for small files", async () => {
    const user = userEvent.setup();
    const file = new File(["pdf"], "D9032-00001.pdf", { type: "application/pdf" });
    const job = makeJob({ status: "queued", stage: "queued" });
    const completedJob = makeJob({
      status: "completed",
      stage: "completed",
      processedFiles: 1,
      result: makeResult(),
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(job, 202))
      .mockResolvedValueOnce(jsonResponse(completedJob, 200));
    vi.mocked(upload).mockImplementation(async (_name, _body, options) => {
      options.onUploadProgress?.({ loaded: 2, total: 3, percentage: 67 });
      await Promise.resolve();
      return {
        url: "https://blob.example/D9032-00001.pdf",
        downloadUrl: "https://blob.example/D9032-00001.pdf",
        pathname: "D9032-00001.pdf",
        contentType: "application/pdf",
        contentDisposition: "inline",
        etag: "etag-1",
      };
    });

    render(<UploadBatchForm blobReady />);

    const input = screen.getByLabelText("Files");
    await user.upload(input, file);
    await screen.findByText(/D9032-00001.pdf/);
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(upload).toHaveBeenCalledWith(
        "D9032-00001.pdf",
        file,
        expect.objectContaining({
          multipart: false,
          contentType: "application/pdf",
          handleUploadUrl: "/api/blob/upload-token",
          onUploadProgress: expect.any(Function),
        }),
      );
    });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/ingest/manual/manual-test",
        expect.objectContaining({ cache: "no-store" }),
      );
    });
    expect((await screen.findAllByText("D9032-00001")).length).toBeGreaterThan(0);
  });

  it("uses multipart Blob upload for large files", async () => {
    const user = userEvent.setup();
    const file = new File(["x"], "large-scan.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: 9 * 1024 * 1024 });
    vi.mocked(upload).mockResolvedValue({
      url: "https://blob.example/large-scan.pdf",
      downloadUrl: "https://blob.example/large-scan.pdf",
      pathname: "large-scan.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
      etag: "etag-2",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(makeJob({ status: "queued" }), 202),
    );

    render(<UploadBatchForm blobReady />);

    const input = screen.getByLabelText("Files");
    await user.upload(input, file);
    fireEvent.submit(input.closest("form")!);

    await waitFor(() => {
      expect(upload).toHaveBeenCalledWith(
        "large-scan.pdf",
        file,
        expect.objectContaining({ multipart: true }),
      );
    });
  });
});

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

function makeJob(
  overrides: Partial<ManualIngestJobSnapshot>,
): ManualIngestJobSnapshot {
  return {
    batchId: "manual-test",
    status: "queued",
    stage: "queued",
    totalFiles: 1,
    processedFiles: 0,
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    ...overrides,
  };
}

function makeResult(): ManualIngestResult {
  return {
    packages: [
      {
        id: "D9032-00001",
        folderId: "D9032-F",
        documentId: "D9032-00001",
        title: "[D9032-00001], D9032-00001.pdf",
        sourceFile: {
          id: "source-1",
          name: "D9032-00001.pdf",
          size: 3,
          mimeType: "application/pdf",
        },
        pages: [],
        status: "needs_review",
        confidence: "medium",
        validationWarnings: [],
        uncertaintyNotes: [],
        createdAt: "2026-05-27T00:00:00.000Z",
        updatedAt: "2026-05-27T00:00:00.000Z",
      },
    ],
    transcriptions: [
      {
        id: "D9032-00001-run-1",
        documentId: "D9032-00001",
        model: "test-model",
        promptVersion: "test",
        ocrText: "hello",
        diplomaticText: "hello",
        uncertainReadings: [],
      },
    ],
    metadata: [],
    transcriptionErrors: [],
  };
}

