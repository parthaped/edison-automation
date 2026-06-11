import { afterEach, describe, expect, it, vi } from "vitest";
import { isTranscriptionEnabled } from "./transcription-config";

describe("transcription-config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables transcription with Gemini", () => {
    vi.stubEnv("EDISON_GEMINI_API_KEY", "");
    expect(isTranscriptionEnabled()).toBe(false);

    vi.stubEnv("EDISON_GEMINI_API_KEY", "AIza_test");
    expect(isTranscriptionEnabled()).toBe(true);
  });
});
