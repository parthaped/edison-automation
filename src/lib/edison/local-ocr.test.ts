import { describe, expect, it, vi } from "vitest";
import { mapLocalOcrResponse, transcribeWithLocalOcr } from "./local-ocr";

describe("mapLocalOcrResponse", () => {
  it("maps direct local OCR text to transcription result", () => {
    const result = mapLocalOcrResponse({
      ocrText: "Body with [filament?]",
      model: "local/trocr-base-edison-v1",
    });

    expect(result).toEqual({
      ocrText: "Body with [filament?]",
      uncertainReadings: ["[filament?]"],
      model: "local/trocr-base-edison-v1",
      promptVersion: "local-htr-v1",
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
  });
});

describe("transcribeWithLocalOcr", () => {
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
});
