// @vitest-environment jsdom
import { upload } from "@vercel/blob/client";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UploadBatchForm } from "./upload-batch-form";
import { ActiveIngestProvider } from "@/components/workbench/active-ingest-provider";
import { MAX_UPLOAD_BYTES } from "@/lib/edison/upload-constraints";
import type { IngestJobSnapshot } from "@/lib/edison/ingest-job-store";
import type { ManualIngestResult } from "@/lib/edison/service";

vi.mock("@vercel/blob/client", () => ({
  upload: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/upload",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("UploadBatchForm", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("blocks over-limit files before starting a Blob upload", async () => {
    const user = userEvent.setup();
    const file = new File(["x"], "large.pdf", { type: "application/pdf" });
    Object.defineProperty(file, "size", { value: MAX_UPLOAD_BYTES + 1 });

    renderWithProvider(<UploadBatchForm blobReady />);

    const input = screen.getByLabelText("Files");
    await user.upload(input, file);
    await screen.findByText(/large.pdf/);
    fireEvent.submit(input.closest("form")!);

    expect(upload).not.toHaveBeenCalled();
    expect(
      screen.getByText(/The per-file limit is 500.0 MB/),
    ).toBeInTheDocument();
  });

  it("uses single-part Blob upload for small files", async () => {
    const user = userEvent.setup();
    const file = new File(["pdf"], "D9032-00001.pdf", { type: "application/pdf" });
    const job = makeJob({ status: "queued" });
    const completedJob = makeJob({
      status: "completed",
      completedFiles: 1,
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

    renderWithProvider(<UploadBatchForm blobReady />);

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
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse(makeJob({ status: "queued" }), 202))
      .mockResolvedValueOnce(
        jsonResponse(
          makeJob({
            status: "completed",
            completedFiles: 1,
            result: makeResult(),
          }),
          200,
        ),
      );

    renderWithProvider(<UploadBatchForm blobReady />);

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

  it("keeps status visible when the upload form unmounts during processing", async () => {
    const user = userEvent.setup();
    const file = new File(["pdf"], "D9032-00002.pdf", { type: "application/pdf" });
    const job = makeJob({ status: "queued" });
    const runningJob = makeJob({
      status: "running",
      completedFiles: 0,
      perFile: [{ fileName: "D9032-00002.pdf", stage: "transcribing" }],
    });
    let statusPolls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      if (String(input) === "/api/ingest/manual") {
        return jsonResponse(job, 202);
      }
      statusPolls += 1;
      return jsonResponse(
        statusPolls === 1 ? runningJob : makeJob({
          status: "completed",
          completedFiles: 1,
          result: makeResult("D9032-00002"),
          perFile: [
            {
              fileName: "D9032-00002.pdf",
              stage: "done",
              documentId: "D9032-00002",
            },
          ],
        }),
        200,
      );
    });
    vi.mocked(upload).mockResolvedValue({
      url: "https://blob.example/D9032-00002.pdf",
      downloadUrl: "https://blob.example/D9032-00002.pdf",
      pathname: "D9032-00002.pdf",
      contentType: "application/pdf",
      contentDisposition: "inline",
      etag: "etag-3",
    });

    function Shell() {
      const [showUpload, setShowUpload] = React.useState(true);
      return (
        <ActiveIngestProvider>
          <button type="button" onClick={() => setShowUpload(false)}>
            Review tab
          </button>
          {showUpload ? <UploadBatchForm blobReady /> : <div>Review page</div>}
        </ActiveIngestProvider>
      );
    }

    render(<Shell />);

    const input = screen.getByLabelText("Files");
    await user.upload(input, file);
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => {
      expect(screen.getAllByText(/Transcribing/).length).toBeGreaterThan(0);
    });
    await user.click(screen.getByRole("button", { name: "Review tab" }));

    expect(screen.getByText("Review page")).toBeInTheDocument();
    expect(screen.getByText(/Transcribing|Transcription complete/)).toBeInTheDocument();
    await screen.findByText(/ready for review/i);
  });

  it("resumes polling a stored batch id on mount", async () => {
    window.sessionStorage.setItem("edison.activeIngestBatchId", "manual-test");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse(
        makeJob({
          status: "completed",
          completedFiles: 1,
          result: makeResult(),
        }),
        200,
      ),
    );

    render(
      <ActiveIngestProvider>
        <div>Review page</div>
      </ActiveIngestProvider>,
    );

    await screen.findByText(/ready for review/i);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/ingest/manual/manual-test",
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(window.sessionStorage.getItem("edison.activeIngestBatchId")).toBeNull();
  });
});

function renderWithProvider(ui: React.ReactElement) {
  return render(<ActiveIngestProvider>{ui}</ActiveIngestProvider>);
}

function jsonResponse(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status });
}

function makeJob(overrides: Partial<IngestJobSnapshot>): IngestJobSnapshot {
  return {
    batchId: "manual-test",
    status: "queued",
    totalFiles: 1,
    completedFiles: 0,
    failedFiles: 0,
    createdAt: "2026-05-27T00:00:00.000Z",
    updatedAt: "2026-05-27T00:00:00.000Z",
    perFile: [
      {
        fileName: "D9032-00001.pdf",
        stage: "uploaded",
      },
    ],
    ...overrides,
  };
}

function makeResult(documentId = "D9032-00001"): ManualIngestResult {
  return {
    packages: [
      {
        id: documentId,
        folderId: "D9032-F",
        documentId,
        title: `[${documentId}], ${documentId}.pdf`,
        sourceFile: {
          id: "source-1",
          name: `${documentId}.pdf`,
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
        id: `${documentId}-run-1`,
        documentId,
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
