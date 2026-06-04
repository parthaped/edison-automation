/** Shared env helpers for laptop Kraken / local OCR integration. */

export function getLocalOcrUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  return env.EDISON_LOCAL_OCR_URL?.trim() || undefined;
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

/** Ingest transcription runs when AI Gateway or local Kraken OCR is configured. */
export function isTranscriptionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    Boolean(env.AI_GATEWAY_API_KEY?.trim()) || isLocalOcrEnabled(env)
  );
}
