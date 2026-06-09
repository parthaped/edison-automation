import { describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn(({ schema }) => schema),
  },
}));

vi.mock("./gemini-model", () => ({
  getDefaultOcrModelLabel: () => "gemini-2.5-flash",
  resolveGeminiModel: (label: string) => label,
}));

import { generateText } from "ai";
import { formatOcrTranscriptionWithGemini } from "./format-ocr-transcription";

describe("formatOcrTranscriptionWithGemini", () => {
  it("returns formatted pages from Gemini", async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: {
        pages: [
          { pageNumber: 1, transcription: "## E2002_Page_01.jpg\n\nBody: Hello" },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    } as never);

    const result = await formatOcrTranscriptionWithGemini({
      documentId: "E2002",
      folderId: "E2002",
      pages: [{ pageNumber: 1, text: "hello raw ocr" }],
    });

    expect(result.pages).toEqual([
      { pageNumber: 1, text: "## E2002_Page_01.jpg\n\nBody: Hello" },
    ]);
    expect(result.promptVersion).toContain("format");
    expect(generateText).toHaveBeenCalledOnce();
  });
});
