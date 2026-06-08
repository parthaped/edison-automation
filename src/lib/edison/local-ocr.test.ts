import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mapLocalOcrResponse,
  transcribePageImageWithLocalOcr,
  transcribeWithLocalOcr,
} from "./local-ocr";

describe("mapLocalOcrResponse", () => {
  it("maps direct local OCR text to transcription result", () => {
    const result = mapLocalOcrResponse({
      ocrText: "Body with [filament?]",
      model: "local/trocr-base-edison-v1",
    });

    expect(result).toMatchObject({
      ocrText: "Body with [filament?]",
      uncertainReadings: ["[filament?]"],
      model: "local/trocr-base-edison-v1",
      promptVersion: "local-qwen-vl-v1",
    });
    expect(result.subDocuments).toHaveLength(1);
    expect(result.subDocuments[0]).toMatchObject({
      startPage: 1,
      endPage: 1,
      ocrText: "Body with [filament?]",
    });
  });

  it("flattens page text when ocrText is absent", () => {
    const result = mapLocalOcrResponse({
      model: "local/kraken-edison-v1",
      promptVersion: "local-htr-v2",
      pages: [
        { pageIndex: 1, text: "Second page" },
        { pageIndex: 0, text: "First page" },
      ],
    });

    expect(result.ocrText).toBe("First page\n\nSecond page");
    expect(result.promptVersion).toBe("local-htr-v2");
    expect(result.subDocuments[0].endPage).toBe(2);
  });
});

describe("transcribeWithLocalOcr", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("posts a document to the local OCR endpoint", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ocrText: "Local text", model: "local/test" }),
          { status: 200 },
        ),
      );

    const result = await transcribeWithLocalOcr(
      {
        bytes: new Uint8Array([1, 2, 3]),
        mediaType: "image/jpeg",
        promptTask: "diplomatic-transcription",
      },
      "http://127.0.0.1:8787/transcribe",
    );

    expect(result.ocrText).toBe("Local text");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/transcribe",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockRestore();
  });

  it("sends the shared secret header when configured", async () => {
    vi.stubEnv("EDISON_LOCAL_OCR_SECRET", "test-secret");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify({ ocrText: "ok", model: "local/test" }),
          { status: 200 },
        ),
      );

    await transcribeWithLocalOcr(
      { bytes: new Uint8Array([1]), mediaType: "image/jpeg" },
      "http://127.0.0.1:8787/transcribe",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8787/transcribe",
      expect.objectContaining({
        headers: { "X-Edison-Ocr-Secret": "test-secret" },
      }),
    );

    vi.unstubAllEnvs();
    fetchMock.mockRestore();
  });
});

describe("transcribePageImageWithLocalOcr", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns page text from the local endpoint", async () => {
    vi.stubEnv("EDISON_LOCAL_OCR_URL", "http://127.0.0.1:8787/transcribe");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ocrText: "Page one",
          model: "local/kraken-en_best-v1",
          promptVersion: "local-kraken-v1",
        }),
        { status: 200 },
      ),
    );

    const result = await transcribePageImageWithLocalOcr({
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result).toEqual({
      text: "Page one",
      model: "local/kraken-en_best-v1",
      promptVersion: "local-kraken-v1",
    });

    vi.unstubAllEnvs();
    fetchMock.mockRestore();
  });
});
