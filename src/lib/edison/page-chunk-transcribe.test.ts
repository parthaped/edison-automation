import { afterEach, describe, expect, it, vi } from "vitest";
import * as aiRequest from "./ai-request";
import * as localOcr from "./local-ocr";
import * as pageChunk from "./page-chunk-transcribe";
import {
  findMissingPagesInChunkResult,
  mergePageChunkResults,
  type TranscribePageChunkFn,
  transcribePageChunkResilient,
} from "./page-chunk-transcribe";

describe("transcribePageChunk with local OCR", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses local Kraken per page instead of generateText", async () => {
    vi.stubEnv("EDISON_LOCAL_OCR_URL", "http://127.0.0.1:8787/transcribe");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(new Uint8Array([1]), { status: 200 }),
    );
    const localSpy = vi
      .spyOn(localOcr, "transcribePageImageWithLocalOcr")
      .mockImplementation(async (input) => ({
        text: `text-${input.bytes[0]}`,
        model: "local/kraken-en_best-v1",
        promptVersion: "local-kraken-v1",
      }));

    const result = await pageChunk.transcribePageChunk({
      pages: [
        { pageNumber: 2, url: "http://example.test/b" },
        { pageNumber: 1, url: "http://example.test/a" },
      ],
    });

    expect(localSpy).toHaveBeenCalledTimes(2);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(result.model).toBe("local/kraken-en_best-v1");
    expect(result.pages).toEqual([
      { pageNumber: 1, text: "text-1" },
      { pageNumber: 2, text: "text-1" },
    ]);
  });
});

describe("findMissingPagesInChunkResult", () => {
  it("lists requested pages absent from the model output", () => {
    const missing = findMissingPagesInChunkResult(
      [
        { pageNumber: 1, url: "http://a" },
        { pageNumber: 2, url: "http://b" },
      ],
      {
        pages: [{ pageNumber: 1, text: "one" }],
        model: "m",
        promptVersion: "v",
      },
    );
    expect(missing).toEqual([2]);
  });
});

describe("transcribePageChunkResilient", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("binary-splits when a large chunk keeps failing", async () => {
    vi.spyOn(aiRequest, "sleepMs").mockResolvedValue(undefined);
    const transcribe: TranscribePageChunkFn = async (input) => {
      if (input.pages.length > 4) {
        throw new Error("request payload too large");
      }
      return {
        pages: input.pages.map((page) => ({
          pageNumber: page.pageNumber,
          text: `text-${page.pageNumber}`,
        })),
        model: "test-model",
        promptVersion: "v1",
      };
    };

    const result = await transcribePageChunkResilient(
      {
        pages: Array.from({ length: 8 }, (_, index) => ({
          pageNumber: index + 1,
          url: `http://page-${index + 1}`,
        })),
      },
      { transcribe },
    );

    expect(result.pages).toHaveLength(8);
    expect(result.pages.map((page) => page.text)).toEqual(
      Array.from({ length: 8 }, (_, index) => `text-${index + 1}`),
    );
  });

  it("retries when the model omits a page then succeeds", async () => {
    vi.spyOn(aiRequest, "sleepMs").mockResolvedValue(undefined);
    let calls = 0;
    const transcribe: TranscribePageChunkFn = async (input) => {
      calls += 1;
      if (calls === 1) {
        return {
          pages: [{ pageNumber: 1, text: "only one" }],
          model: "test-model",
          promptVersion: "v1",
        };
      }
      return {
        pages: input.pages.map((page) => ({
          pageNumber: page.pageNumber,
          text: `text-${page.pageNumber}`,
        })),
        model: "test-model",
        promptVersion: "v1",
      };
    };

    const result = await transcribePageChunkResilient(
      {
        pages: [
          { pageNumber: 1, url: "http://1" },
          { pageNumber: 2, url: "http://2" },
        ],
      },
      { transcribe },
    );

    expect(calls).toBeGreaterThan(1);
    expect(result.pages).toHaveLength(2);
  });
});

describe("mergePageChunkResults", () => {
  const metadata = {
    title: "Sample",
    documentType: "correspondence",
    date: "1890",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
    places: [],
  };

  it("orders pages and produces one sub-document by default", () => {
    const merged = mergePageChunkResults(
      [
        {
          pages: [
            { pageNumber: 2, text: "Page two" },
            { pageNumber: 1, text: "Page one" },
          ],
          model: "test-model",
          promptVersion: "v1",
        },
        {
          pages: [{ pageNumber: 3, text: "Page three" }],
          model: "test-model",
          promptVersion: "v1",
        },
      ],
      3,
      metadata,
    );

    expect(merged.subDocuments).toHaveLength(1);
    expect(merged.subDocuments[0].startPage).toBe(1);
    expect(merged.subDocuments[0].endPage).toBe(3);
    expect(merged.ocrText).toBe("Page one\n\nPage two\n\nPage three");
    expect(merged.model).toBe("test-model");
  });

  it("splits merged page text with chunked sub-document plans", () => {
    const merged = mergePageChunkResults(
      [
        {
          pages: [
            { pageNumber: 1, text: "First letter page one" },
            { pageNumber: 2, text: "First letter page two" },
          ],
          model: "test-model",
          promptVersion: "v1",
        },
        {
          pages: [
            { pageNumber: 3, text: "Second letter page one" },
            { pageNumber: 4, text: "Second letter page two [unclear?]" },
          ],
          model: "test-model",
          promptVersion: "v1",
        },
      ],
      4,
      metadata,
      [
        {
          startPage: 1,
          endPage: 2,
          metadata: { ...metadata, title: "First" },
        },
        {
          startPage: 3,
          endPage: 4,
          metadata: { ...metadata, title: "Second" },
        },
      ],
    );

    expect(merged.subDocuments).toHaveLength(2);
    expect(merged.subDocuments[0]).toMatchObject({
      startPage: 1,
      endPage: 2,
      ocrText: "First letter page one\n\nFirst letter page two",
      metadata: { title: "First" },
    });
    expect(merged.subDocuments[1]).toMatchObject({
      startPage: 3,
      endPage: 4,
      metadata: { title: "Second" },
    });
    expect(merged.subDocuments[1].uncertainReadings).toEqual(["[unclear?]"]);
  });

  it("normalizes chunked split plans so every page is covered", () => {
    const merged = mergePageChunkResults(
      [
        {
          pages: [
            { pageNumber: 1, text: "p1" },
            { pageNumber: 2, text: "p2" },
            { pageNumber: 3, text: "p3" },
            { pageNumber: 4, text: "p4" },
          ],
          model: "test-model",
          promptVersion: "v1",
        },
      ],
      4,
      metadata,
      [
        {
          startPage: 2,
          endPage: 2,
          metadata: { ...metadata, title: "First" },
        },
        {
          startPage: 2,
          endPage: 3,
          metadata: { ...metadata, title: "Second" },
        },
      ],
    );

    expect(
      merged.subDocuments.map((sub) => [sub.startPage, sub.endPage]),
    ).toEqual([
      [1, 2],
      [3, 4],
    ]);
    expect(merged.subDocuments[0].ocrText).toBe("p1\n\np2");
    expect(merged.subDocuments[1].ocrText).toBe("p3\n\np4");
  });
});
