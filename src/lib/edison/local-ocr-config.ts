/** Shared env helpers for remote Qwen / HTTP OCR (Amarel pull queue or direct URL). */

import { isGeminiConfigured } from "./gemini-config";
import { isOcrQueueEnabled } from "./ocr-queue-config";

export function getLocalOcrUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return (
    env.EDISON_REMOTE_OCR_URL?.trim() ||
    env.EDISON_LOCAL_OCR_URL?.trim() ||
    undefined
  );
}

export function getLocalOcrSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.EDISON_LOCAL_OCR_SECRET?.trim() || undefined;
}

export function isLocalOcrEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(getLocalOcrUrl(env));
}

/** Ingest transcription runs when Gemini, OCR queue, or direct HTTP OCR is configured. */
export function isTranscriptionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isGeminiConfigured(env) ||
    isOcrQueueEnabled(env) ||
    isLocalOcrEnabled(env)
  );
}
