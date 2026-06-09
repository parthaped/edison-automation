/** Pull-based OCR queue: Amarel workers claim jobs from Vercel (no inbound tunnel). */

export function isOcrQueueEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.EDISON_OCR_QUEUE_ENABLED?.trim().toLowerCase() === "true";
}

export function getOcrWorkerSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.EDISON_OCR_WORKER_SECRET?.trim() || undefined;
}

export function isOcrWorkerSecretConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(getOcrWorkerSecret(env));
}

export function getOcrQueuePollMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.EDISON_OCR_QUEUE_POLL_MS);
  return Number.isFinite(raw) && raw >= 1000 ? Math.floor(raw) : 5000;
}

export function getOcrQueueTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = Number(env.EDISON_OCR_QUEUE_TIMEOUT_MS);
  return Number.isFinite(raw) && raw >= 60_000
    ? Math.floor(raw)
    : 2 * 60 * 60 * 1000;
}

export function getEdisonPublicBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const explicit = env.EDISON_PUBLIC_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  const vercel = env.VERCEL_URL?.trim();
  if (vercel) {
    return `https://${vercel.replace(/^https?:\/\//, "")}`;
  }
  return "http://localhost:3000";
}
