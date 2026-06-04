import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getLocalOcrSecret,
  getLocalOcrUrl,
  isLocalOcrEnabled,
  isTranscriptionEnabled,
  shouldUseGatewayForMetadata,
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

  it("enables transcription with gateway or local OCR", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("EDISON_LOCAL_OCR_URL", "");
    expect(isTranscriptionEnabled()).toBe(false);

    vi.stubEnv("EDISON_LOCAL_OCR_URL", "http://127.0.0.1:8787/transcribe");
    expect(isTranscriptionEnabled()).toBe(true);

    vi.stubEnv("EDISON_LOCAL_OCR_URL", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    expect(isTranscriptionEnabled()).toBe(true);
  });

  it("reads OCR secret", () => {
    vi.stubEnv("EDISON_LOCAL_OCR_SECRET", " shared-secret ");
    expect(getLocalOcrSecret()).toBe("shared-secret");
  });

  it("uses gateway for metadata only when AI Gateway is configured", () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    expect(shouldUseGatewayForMetadata()).toBe(false);

    vi.stubEnv("AI_GATEWAY_API_KEY", "test-key");
    expect(shouldUseGatewayForMetadata()).toBe(true);
  });
});
