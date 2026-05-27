import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BoxUploadQueue } from "./box-upload-queue";
import { sampleBoxUploads } from "@/lib/edison/sample-data";

describe("BoxUploadQueue", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows completed Box uploads with their associated folder", () => {
    render(<BoxUploadQueue uploads={sampleBoxUploads} />);

    expect(screen.getByText("D9032-00002.pdf")).toBeInTheDocument();
    expect(screen.getByText("D9032-F Electric Light Philadelphia")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start transcription" })).toBeInTheDocument();
  });

  it("starts transcription only after the user clicks", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ accepted: true }), { status: 202 }),
    );
    render(<BoxUploadQueue uploads={sampleBoxUploads} />);

    await user.click(screen.getByRole("button", { name: "Start transcription" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/box/uploads/box-upload-987654321/start-transcription",
      { method: "POST" },
    );
    expect(screen.getByRole("button", { name: "Queued for pipeline" })).toBeDisabled();
  });
});
