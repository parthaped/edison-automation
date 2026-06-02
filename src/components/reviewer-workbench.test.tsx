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

describe("ReviewerWorkbench", () => {
  it("renders document identifiers and editable transcription", () => {
    render(
      <ReviewerWorkbench
        documents={[sampleDocuments[0]]}
        transcriptions={transcriptionsById}
        metadata={metadataById}
      />,
    );

    expect(screen.getByText("D9032-F")).toBeInTheDocument();
    expect(screen.getAllByText("D9032-00001").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByLabelText("Diplomatic transcription")).toHaveValue(
      sampleTranscription.diplomaticText,
    );
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

    const textarea = screen.getByLabelText("Diplomatic transcription");
    await user.clear(textarea);
    await user.type(textarea, "Corrected transcription");

    expect(textarea).toHaveValue("Corrected transcription");
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
    expect(link).toHaveAttribute("href", "/viewer/D9032-00001");
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
      "/api/documents/D9032-00001",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(routerMocks.push).toHaveBeenCalledWith("/review");
    expect(routerMocks.refresh).toHaveBeenCalled();
  });
});
