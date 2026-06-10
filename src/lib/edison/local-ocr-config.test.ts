import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLocalOcrSecret,
  getLocalOcrUrl,
  isLocalOcrEnabled,
  isTranscriptionEnabled,
} from "./local-ocr-config";

describe("local-ocr-config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects local OCR URL", () => {
    vi.stubEnv("EDISON_LOCAL_OCR_URL", "https://ocr.example.com/transcribe");
    expect(isLocalOcrEnabled()).toBe(true);
    expect(getLocalOcrUrl()).toBe("https://ocr.example.com/transcribe");
  });

  it("prefers EDISON_REMOTE_OCR_URL over EDISON_LOCAL_OCR_URL", () => {
    vi.stubEnv("EDISON_REMOTE_OCR_URL", "https://amarel.example.com/transcribe");
    vi.stubEnv("EDISON_LOCAL_OCR_URL", "https://legacy.example.com/transcribe");
    expect(getLocalOcrUrl()).toBe("https://amarel.example.com/transcribe");
  });

  it("enables transcription with gateway, OCR queue, or local OCR", () => {
    vi.stubEnv("EDISON_GEMINI_API_KEY", "");
    vi.stubEnv("EDISON_LOCAL_OCR_URL", "");
    expect(isTranscriptionEnabled()).toBe(false);

    vi.stubEnv("EDISON_LOCAL_OCR_URL", "http://127.0.0.1:8787/transcribe");
    expect(isTranscriptionEnabled()).toBe(true);

    vi.stubEnv("EDISON_LOCAL_OCR_URL", "");
    vi.stubEnv("EDISON_OCR_QUEUE_ENABLED", "true");
    expect(isTranscriptionEnabled()).toBe(true);

    vi.stubEnv("EDISON_OCR_QUEUE_ENABLED", "");
    vi.stubEnv("EDISON_GEMINI_API_KEY", "AIza_test");
    expect(isTranscriptionEnabled()).toBe(true);
  });

  it("reads OCR secret", () => {
    vi.stubEnv("EDISON_LOCAL_OCR_SECRET", " shared-secret ");
    expect(getLocalOcrSecret()).toBe("shared-secret");
  });
});
