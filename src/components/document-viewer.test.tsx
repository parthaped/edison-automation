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

  it("applies zoom transform when zoom in is clicked", async () => {
    const user = userEvent.setup();
    renderViewer();

    await user.click(screen.getByLabelText("Zoom in"));

    const transformLayer = screen.getByTestId("viewer-transform-layer");
    expect(transformLayer.style.transform).toContain("scale(1.25)");
  });

  it("disables zoom controls in grid layout", async () => {
    const user = userEvent.setup();
    renderViewer();

    await user.click(screen.getByLabelText("Grid"));

    expect(screen.getByLabelText("Zoom in")).toBeDisabled();
    expect(screen.getByLabelText("Zoom out")).toBeDisabled();
    expect(screen.getByLabelText("Rotate 90 degrees")).toBeDisabled();
    expect(screen.getByLabelText("Reset view")).toBeDisabled();
    expect(screen.getByLabelText("Viewer settings")).toBeDisabled();
  });

  it("disables download when no source URL is available", () => {
    renderViewer();
    expect(
      screen.getByLabelText("Download unavailable — source image not yet attached"),
    ).toBeDisabled();
  });

  it("downloads source when originalUrl is present", async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click");
    const documentWithUrl = {
      ...multiPageDocument,
      pages: multiPageDocument.pages.map((page, index) =>
        index === 0
          ? { ...page, originalUrl: "https://blob.example/page-1.jpg" }
          : page,
      ),
    } as DocumentPackage;

    renderViewer({ document: documentWithUrl });

    const downloadButton = screen.getByLabelText("Download source");
    expect(downloadButton).not.toBeDisabled();

    await user.click(downloadButton);

    expect(clickSpy).toHaveBeenCalled();
    clickSpy.mockRestore();
  });

  it("opens on the requested initial page", () => {
    renderViewer({ initialPage: 1 });

    const pageInput = screen.getByLabelText("Go to page") as HTMLInputElement;
    expect(pageInput.value).toBe("2");
  });
});
