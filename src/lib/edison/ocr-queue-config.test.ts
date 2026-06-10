import { afterEach, describe, expect, it, vi } from "vitest";
import {
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
});
