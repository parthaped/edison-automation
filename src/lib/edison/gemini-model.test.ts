import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDefaultOcrModelLabel,
  normalizeGeminiModelId,
} from "./gemini-model";

describe("gemini-model", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes google/ model prefix", () => {
    expect(normalizeGeminiModelId("google/gemini-2.5-flash")).toBe(
      "gemini-2.5-flash",
    );
  });

  it("returns default model label", () => {
    expect(getDefaultOcrModelLabel()).toBe("google/gemini-2.5-flash");
  });
});
