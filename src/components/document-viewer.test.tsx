import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DocumentViewer } from "./document-viewer";
import {
  sampleDocuments,
  sampleTranscription,
} from "@/lib/edison/sample-data";
import type { DocumentPackage } from "@/lib/edison/types";

const multiPageDocument = sampleDocuments[0];
const blockedDocument = sampleDocuments[2];

function renderViewer(
  overrides: Partial<React.ComponentProps<typeof DocumentViewer>> = {},
) {
  return render(
    <DocumentViewer
      document={overrides.document ?? (multiPageDocument as DocumentPackage)}
      transcription={overrides.transcription ?? sampleTranscription}
      {...overrides}
    />,
  );
}

describe("DocumentViewer", () => {
  it("renders page input with current and total pages, and advances on Next", async () => {
    const user = userEvent.setup();
    renderViewer();

    const pageInput = screen.getByLabelText("Go to page") as HTMLInputElement;
    expect(pageInput.value).toBe("1");
    expect(screen.getByText(/of 2/)).toBeInTheDocument();

    await user.click(screen.getByLabelText("Next page"));

    expect(pageInput.value).toBe("2");
  });

  it("falls back to facsimile when originalUrl is missing", () => {
    renderViewer();
    expect(
      screen.getByLabelText(/Page 1 facsimile/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Source image not yet attached/i),
    ).toBeInTheDocument();
  });

  it("notifies the parent when the transcription is edited", async () => {
    const user = userEvent.setup();
    const onTranscriptionChange = vi.fn();
    renderViewer({ onTranscriptionChange });

    const textarea = screen.getByLabelText("Diplomatic transcription");
    await user.type(textarea, " extra");

    expect(onTranscriptionChange).toHaveBeenCalled();
    const lastCallArg = onTranscriptionChange.mock.calls.at(-1)?.[0];
    expect(typeof lastCallArg).toBe("string");
    expect(lastCallArg).toContain("extra");
  });

  it("selects an uncertain reading in the textarea when its chip is clicked", async () => {
    const user = userEvent.setup();
    renderViewer();

    const textarea = screen.getByLabelText(
      "Diplomatic transcription",
    ) as HTMLTextAreaElement;
    const token = "[filament?]";
    const expectedIndex = textarea.value.indexOf(token);
    expect(expectedIndex).toBeGreaterThanOrEqual(0);

    await user.click(screen.getByRole("button", { name: token }));

    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(expectedIndex);
    expect(textarea.selectionEnd).toBe(expectedIndex + token.length);
  });

  it("shows the empty stage when a document has no extracted pages", () => {
    renderViewer({ document: blockedDocument as DocumentPackage });
    expect(
      screen.getByText("No extracted pages available."),
    ).toBeInTheDocument();
  });
});
