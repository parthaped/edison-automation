import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getEdisonPublicBaseUrl,
  getOcrQueuePollMs,
  isOcrQueueEnabled,
} from "./ocr-queue-config";

describe("ocr-queue-config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects queue mode", () => {
    vi.stubEnv("EDISON_OCR_QUEUE_ENABLED", "true");
    expect(isOcrQueueEnabled()).toBe(true);
  });

  it("defaults poll interval to 5s", () => {
    expect(getOcrQueuePollMs()).toBe(5000);
  });

  it("builds public base URL from EDISON_PUBLIC_URL", () => {
    vi.stubEnv("EDISON_PUBLIC_URL", "https://edison.example.com/");
    expect(getEdisonPublicBaseUrl()).toBe("https://edison.example.com");
  });
});
