import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ReviewerWorkbench } from "./reviewer-workbench";
import {
  sampleDocuments,
  sampleMetadata,
  sampleReviewEvents,
  sampleTranscription,
} from "@/lib/edison/sample-data";

describe("ReviewerWorkbench", () => {
  it("renders document identifiers and editable transcription", () => {
    render(
      <ReviewerWorkbench
        documents={[sampleDocuments[0]]}
        transcription={sampleTranscription}
        metadata={sampleMetadata}
        reviewEvents={sampleReviewEvents}
      />,
    );

    expect(screen.getByText("D9032-F")).toBeInTheDocument();
    expect(screen.getByText("D9032-00001")).toBeInTheDocument();
    expect(screen.getByLabelText("Diplomatic transcription")).toHaveValue(
      sampleTranscription.diplomaticText,
    );
  });

  it("allows reviewers to edit transcription text", async () => {
    const user = userEvent.setup();
    render(
      <ReviewerWorkbench
        documents={[sampleDocuments[0]]}
        transcription={sampleTranscription}
        metadata={sampleMetadata}
        reviewEvents={sampleReviewEvents}
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
        transcription={sampleTranscription}
        metadata={sampleMetadata}
        reviewEvents={sampleReviewEvents}
      />,
    );

    expect(screen.getByText("No extracted pages available.")).toBeInTheDocument();
  });
});
