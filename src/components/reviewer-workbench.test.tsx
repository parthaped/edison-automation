import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReviewerWorkbench } from "./reviewer-workbench";
import {
  sampleDocuments,
  sampleMetadata,
  sampleTranscription,
} from "@/lib/edison/sample-data";

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
});
