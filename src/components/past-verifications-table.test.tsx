// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  PastVerificationsTable,
  type PastVerificationRow,
} from "./past-verifications-table";

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

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function makeRow(overrides: Partial<PastVerificationRow> = {}): PastVerificationRow {
  return {
    documentId: "E2002AAA",
    folderId: "E2002",
    title: "Traiser to Edison",
    date: "1919-12-29",
    confidence: "high",
    approvedAt: "2026-06-01T12:00:00.000Z",
    ...overrides,
  };
}

describe("PastVerificationsTable", () => {
  it("renders an empty state when no approved documents exist", () => {
    render(
      <PastVerificationsTable
        rows={[]}
        totalCount={0}
        offset={0}
        limit={50}
        hasMore={false}
      />,
    );
    expect(
      screen.getByText("No approved transcriptions yet"),
    ).toBeInTheDocument();
  });

  it("links each row's CSV button to the per-document export route", () => {
    render(
      <PastVerificationsTable
        rows={[makeRow()]}
        totalCount={1}
        offset={0}
        limit={50}
        hasMore={false}
      />,
    );
    const csvLink = screen.getByRole("link", { name: /^csv$/i });
    expect(csvLink).toHaveAttribute(
      "href",
      "/api/export/transcriptions/E2002AAA",
    );
    expect(csvLink).toHaveAttribute("download", "E2002AAA-omeka.csv");
  });

  it("optimistically removes a row when send-back succeeds", async () => {
    const user = userEvent.setup();
    routerMocks.refresh.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true }),
      }),
    );

    render(
      <PastVerificationsTable
        rows={[makeRow(), makeRow({ documentId: "E2002AAB", folderId: "E2002" })]}
        totalCount={2}
        offset={0}
        limit={50}
        hasMore={false}
      />,
    );

    expect(screen.getAllByText("E2002AAA").length).toBe(1);
    await user.click(screen.getAllByRole("button", { name: /send back/i })[0]);

    expect(fetch).toHaveBeenCalledWith(
      "/api/documents/E2002AAA",
      expect.objectContaining({ method: "PATCH" }),
    );
    expect(routerMocks.refresh).toHaveBeenCalled();
    // Optimistic removal: the row disappears immediately.
    expect(screen.queryByText("E2002AAA")).not.toBeInTheDocument();
    expect(screen.getByText("E2002AAB")).toBeInTheDocument();
  });
});
