// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReviewerWorkbench } from "./reviewer-workbench";
import {
  sampleDocuments,
  sampleMetadata,
  sampleTranscription,
} from "@/lib/edison/sample-data";
import type { DocumentPackage, SourceGroup } from "@/lib/edison/types";

// The workbench calls `useRouter()` to refresh after split edits. The test
// environment doesn't mount an app-router context, so we stub the hook to a
// no-op router. The mock is hoisted so it applies before the component is
// imported.
const routerMocks = {
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const transcriptionsById = {
  [sampleTranscription.documentId]: sampleTranscription,
};
const metadataById = {
  [sampleMetadata.documentId]: sampleMetadata,
};

const multiFileGroup: SourceGroup = {
  groupId: "GROUP-A",
  originalFileName: "batch.pdf",
  position: 0,
  siblingIds: ["DOC-A", "DOC-A-1", "DOC-A-2"],
  totalPages: 6,
};

function makeReviewDoc(
  documentId: string,
  title: string,
  sourceGroup?: SourceGroup,
): DocumentPackage {
  return {
    id: documentId,
    folderId: "F1",
    documentId,
    title,
    sourceFile: {
      id: `file-${documentId}`,
      name: `${documentId}.pdf`,
      size: 1000,
      mimeType: "application/pdf",
    },
    pages: [
      {
        id: `${documentId}-page-1`,
        documentId,
        pageIndex: 0,
        imageFilename: `${documentId}/page1.jpg`,
        sourcePage: 1,
      },
    ],
    status: "needs_review",
    confidence: "medium",
    validationWarnings: [],
    uncertaintyNotes: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    sourceGroup,
  };
}

const multiFileDocuments = [
  makeReviewDoc("DOC-A", "First letter", {
    ...multiFileGroup,
    position: 0,
  }),
  makeReviewDoc("DOC-A-1", "Second letter", {
    ...multiFileGroup,
    position: 1,
  }),
  makeReviewDoc("DOC-A-2", "Third letter", {
    ...multiFileGroup,
    position: 2,
  }),
  makeReviewDoc("DOC-B", "Other file document"),
];

const multiFileTranscriptions = Object.fromEntries(
  multiFileDocuments.map((doc) => [
    doc.documentId,
    {
      ...sampleTranscription,
      id: `${doc.documentId}-transcription`,
      documentId: doc.documentId,
      diplomaticText: `Text for ${doc.documentId}`,
    },
  ]),
);

const multiFileMetadata = Object.fromEntries(
  multiFileDocuments.map((doc) => [
    doc.documentId,
    {
      ...sampleMetadata,
      documentId: doc.documentId,
      title: doc.title,
    },
  ]),
);

describe("ReviewerWorkbench", () => {
  it("renders document identifiers and editable transcription", () => {
    render(
      <ReviewerWorkbench
        documents={[sampleDocuments[0]]}
        transcriptions={transcriptionsById}
        metadata={metadataById}
      />,
    );

    expect(screen.getAllByText("E2002").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("E2002AAA").length).toBeGreaterThanOrEqual(1);
    expect(
      (screen.getByLabelText("Body text") as HTMLTextAreaElement).value,
    ).toContain("[filament?]");
  });

  it("allows reviewers to edit transcription text", async () => {
    const user = userEvent.setup();
    render(
      <ReviewerWorkbench
        documents={[sampleDocuments[0]]}
        transcriptions={transcriptionsById}
        metadata={metadataById}
      />,
    );

    const bodyField = screen.getByLabelText("Body text");
    await user.clear(bodyField);
    await user.type(bodyField, "Corrected transcription");

    expect(bodyField).toHaveValue("Corrected transcription");
  });

  it("shows blocked files without crashing the viewer", () => {
    render(
      <ReviewerWorkbench
        documents={[sampleDocuments[2]]}
        transcriptions={transcriptionsById}
        metadata={metadataById}
      />,
    );

    expect(screen.getByText("No extracted pages available.")).toBeInTheDocument();
  });

  it("exposes a link to the standalone viewer", () => {
    render(
      <ReviewerWorkbench
        documents={[sampleDocuments[0]]}
        transcriptions={transcriptionsById}
        metadata={metadataById}
      />,
    );

    const link = screen.getByRole("link", { name: /open standalone/i });
    expect(link).toHaveAttribute("href", "/viewer/E2002AAA");
  });

  it("shows a remove control for mistakenly uploaded files", async () => {
    const user = userEvent.setup();
    routerMocks.push.mockClear();
    routerMocks.refresh.mockClear();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );

    render(
      <ReviewerWorkbench
        documents={[sampleDocuments[0]]}
        transcriptions={transcriptionsById}
        metadata={metadataById}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(
      screen.getByText("Remove this file from review?"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /confirm remove/i }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/documents/E2002AAA",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(routerMocks.push).toHaveBeenCalledWith("/workbench/review");
    expect(routerMocks.refresh).toHaveBeenCalled();
  });

  it("advances Next to the next file, not the next sibling", async () => {
    const user = userEvent.setup();
    routerMocks.push.mockClear();

    render(
      <ReviewerWorkbench
        documents={multiFileDocuments}
        transcriptions={multiFileTranscriptions}
        metadata={multiFileMetadata}
        initialDocumentId="DOC-A-1"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Second letter" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^next$/i }));

    expect(routerMocks.push).toHaveBeenCalledWith(
      "/workbench/review?doc=DOC-B",
    );
  });

  it("shows file count in queue position when siblings share one source file", () => {
    render(
      <ReviewerWorkbench
        documents={multiFileDocuments}
        transcriptions={multiFileTranscriptions}
        metadata={multiFileMetadata}
        initialDocumentId="DOC-A-2"
      />,
    );

    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
  });

  it("removes the approved file from the local queue and advances to the next file", async () => {
    const user = userEvent.setup();
    routerMocks.push.mockClear();
    routerMocks.refresh.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );

    render(
      <ReviewerWorkbench
        documents={multiFileDocuments}
        transcriptions={multiFileTranscriptions}
        metadata={multiFileMetadata}
        initialDocumentId="DOC-A"
      />,
    );

    // The first file (DOC-A and its siblings) sits at position 1 of 2.
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^approve & next$/i }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/documents/DOC-A",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(routerMocks.push).toHaveBeenCalledWith("/workbench/review?doc=DOC-B");
    expect(routerMocks.refresh).toHaveBeenCalled();
  });
});
