// Shared timeout and transient-error helpers for AI Gateway calls.

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

export function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("rate limit") ||
    message.includes("429") ||
    message.includes("500") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504") ||
    message.includes("overloaded") ||
    message.includes("resource exhausted") ||
    message.includes("unavailable") ||
    message.includes("internal server") ||
    message.includes("network") ||
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("socket") ||
    message.includes("aborted")
  );
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
