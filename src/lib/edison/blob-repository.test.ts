import { beforeEach, describe, expect, it, vi } from "vitest";
import { BlobEdisonRepository } from "./blob-repository";

const listMock = vi.fn();

vi.mock("@vercel/blob", () => ({
  list: (...args: unknown[]) => listMock(...args),
  put: vi.fn(),
}));

describe("BlobEdisonRepository", () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it("paginates list() until hasMore is false when listing document ids", async () => {
    listMock
      .mockResolvedValueOnce({
        blobs: [
          {
            pathname: "records/E2002AAA.json",
            url: "https://blob.example/1",
          },
        ],
        hasMore: true,
        cursor: "page-2",
      })
      .mockResolvedValueOnce({
        blobs: [
          {
            pathname: "records/E2002AAB.json",
            url: "https://blob.example/2",
          },
        ],
        hasMore: false,
        cursor: undefined,
      });

    const repository = new BlobEdisonRepository();
    const ids = await repository.listDocumentIds();

    expect(ids).toEqual(["E2002AAA", "E2002AAB"]);
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock.mock.calls[0]?.[0]).toMatchObject({
      prefix: "records/",
      limit: 1000,
      cursor: undefined,
    });
    expect(listMock.mock.calls[1]?.[0]).toMatchObject({
      prefix: "records/",
      limit: 1000,
      cursor: "page-2",
    });
  });
});
