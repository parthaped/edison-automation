// Shared timeout and transient-error helpers for Gemini / OCR HTTP calls.

export const DEFAULT_AI_TIMEOUT_MS = 45_000;

export function getRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.EDISON_AI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_AI_TIMEOUT_MS;
}

export function combineSignals(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error("AI request timed out")),
    timeoutMs,
  );
  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else if (typeof current === "string") {
      messages.push(current);
      break;
    } else {
      messages.push(String(current));
      break;
    }
  }
  return messages;
}

export function isRateLimitError(error: unknown): boolean {
  const combined = collectErrorMessages(error).join(" ").toLowerCase();
  return (
    combined.includes("rate-limited") ||
    combined.includes("rate limit") ||
    combined.includes("429") ||
    combined.includes("free tier")
  );
}

export function isTransientError(error: unknown): boolean {
  if (isRateLimitError(error)) return true;
  const combined = collectErrorMessages(error).join(" ").toLowerCase();
  return (
    combined.includes("timeout") ||
    combined.includes("timed out") ||
    combined.includes("429") ||
    combined.includes("500") ||
    combined.includes("502") ||
    combined.includes("503") ||
    combined.includes("504") ||
    combined.includes("overloaded") ||
    combined.includes("resource exhausted") ||
    combined.includes("unavailable") ||
    combined.includes("internal server") ||
    combined.includes("network") ||
    combined.includes("fetch failed") ||
    combined.includes("econnreset") ||
    combined.includes("socket") ||
    combined.includes("aborted")
  );
}

/** Longer backoff for Gemini API quota rate limits. */
export function rateLimitBackoffMs(attemptIndex: number): number {
  const steps = [5000, 15000, 30000];
  return steps[Math.min(attemptIndex, steps.length - 1)] ?? 30000;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with small jitter for in-step AI retries. */
export function retryBackoffMs(attemptIndex: number): number {
  const base = 1000 * 2 ** attemptIndex;
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}
