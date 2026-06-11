import { isGeminiConfigured } from "./gemini-config";

/** Ingest transcription runs when Gemini is configured. */
export function isTranscriptionEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return isGeminiConfigured(env);
}
