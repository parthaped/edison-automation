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

export function isGatewayEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env.AI_GATEWAY_API_KEY?.trim());
}

/** Ingest transcription runs when AI Gateway or local Kraken OCR is configured. */
export function isTranscriptionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isGatewayEnabled(env) || isLocalOcrEnabled(env);
}

/** Catalog metadata / document splitting via gateway (text-only when Kraken was used). */
export function shouldUseGatewayForMetadata(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isGatewayEnabled(env);
}
