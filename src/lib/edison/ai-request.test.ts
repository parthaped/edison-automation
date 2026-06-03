import { describe, expect, it } from "vitest";
import { isRateLimitError, isTransientError, retryBackoffMs } from "./ai-request";

describe("isTransientError", () => {
  it("detects rate limits and gateway errors", () => {
    expect(isTransientError(new Error("rate limit exceeded"))).toBe(true);
    expect(
      isTransientError(
        new Error(
          "Free tier requests on this model are rate-limited. Upgrade to paid credits.",
        ),
      ),
    ).toBe(true);
    expect(isRateLimitError(new Error("HTTP 429"))).toBe(true);
    expect(isTransientError(new Error("HTTP 429"))).toBe(true);
    expect(isTransientError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isTransientError(new Error("resource exhausted"))).toBe(true);
  });

  it("detects timeouts and network failures", () => {
    expect(isTransientError(new Error("AI request timed out"))).toBe(true);
    expect(isTransientError(new Error("fetch failed"))).toBe(true);
    expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
  });

  it("returns false for non-errors and validation failures", () => {
    expect(isTransientError("nope")).toBe(false);
    expect(isTransientError(new Error("invalid schema"))).toBe(false);
  });
});

describe("retryBackoffMs", () => {
  it("grows with attempt index", () => {
    expect(retryBackoffMs(0)).toBeGreaterThanOrEqual(1000);
    expect(retryBackoffMs(1)).toBeGreaterThan(retryBackoffMs(0));
  });
});
