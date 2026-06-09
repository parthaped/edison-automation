/** Google Gemini via API key (AI Studio) or Vertex AI service account. */

/** Primary Edison alias; Vercel often sets {@link GOOGLE_GENERATIVE_AI_API_KEY} instead (both work). */
export const EDISON_GEMINI_API_KEY_ENV = "EDISON_GEMINI_API_KEY";

export const GOOGLE_GENERATIVE_AI_API_KEY_ENV = "GOOGLE_GENERATIVE_AI_API_KEY";

const GEMINI_API_KEY_ALIASES = [
  EDISON_GEMINI_API_KEY_ENV,
  GOOGLE_GENERATIVE_AI_API_KEY_ENV,
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
] as const;

/** Human-readable hint for setup docs and UI copy. */
export const GEMINI_API_KEY_ENV_HINT =
  "GOOGLE_GENERATIVE_AI_API_KEY or EDISON_GEMINI_API_KEY";

export const DEFAULT_VERTEX_LOCATION = "us-central1";

export interface ServiceAccountCredentials {
  client_email: string;
  private_key: string;
  project_id?: string;
}

export type GeminiAuthMode = "api-key" | "vertex";

export function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n");
}

export function getGeminiApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  for (const name of GEMINI_API_KEY_ALIASES) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function getVertexProjectId(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const fromEnv =
    env.EDISON_GCP_PROJECT_ID?.trim() ||
    env.GOOGLE_CLOUD_PROJECT?.trim() ||
    env.GCP_PROJECT_ID?.trim() ||
    env.GCLOUD_PROJECT?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  return getServiceAccountCredentials(env)?.project_id;
}

export function getVertexLocation(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.EDISON_GCP_LOCATION?.trim() ||
    env.GOOGLE_CLOUD_LOCATION?.trim() ||
    DEFAULT_VERTEX_LOCATION
  );
}

function parseServiceAccountJson(raw: string): ServiceAccountCredentials {
  const parsed = JSON.parse(raw) as {
    client_email?: string;
    private_key?: string;
    project_id?: string;
  };
  if (!parsed.client_email?.trim() || !parsed.private_key?.trim()) {
    throw new Error(
      "Service account JSON must include client_email and private_key.",
    );
  }
  return {
    client_email: parsed.client_email.trim(),
    private_key: normalizePrivateKey(parsed.private_key),
    project_id: parsed.project_id?.trim(),
  };
}

export function getServiceAccountCredentials(
  env: NodeJS.ProcessEnv = process.env,
): ServiceAccountCredentials | undefined {
  const jsonRaw =
    env.EDISON_GCP_SERVICE_ACCOUNT_JSON?.trim() ||
    env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim();
  if (jsonRaw) {
    return parseServiceAccountJson(jsonRaw);
  }

  const clientEmail =
    env.EDISON_GCP_CLIENT_EMAIL?.trim() || env.GOOGLE_CLIENT_EMAIL?.trim();
  const privateKey =
    env.EDISON_GCP_PRIVATE_KEY?.trim() || env.GOOGLE_PRIVATE_KEY?.trim();
  if (clientEmail && privateKey) {
    return {
      client_email: clientEmail,
      private_key: normalizePrivateKey(privateKey),
    };
  }

  return undefined;
}

export function getGeminiAuthMode(
  env: NodeJS.ProcessEnv = process.env,
): GeminiAuthMode | null {
  if (getServiceAccountCredentials(env) && getVertexProjectId(env)) {
    return "vertex";
  }
  if (getGeminiApiKey(env)) {
    return "api-key";
  }
  return null;
}

export function isVertexConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getGeminiAuthMode(env) === "vertex";
}

/** AI SDK @ai-sdk/google reads `GOOGLE_GENERATIVE_AI_API_KEY`. */
export function ensureGeminiEnv(env: NodeJS.ProcessEnv = process.env): void {
  const apiKey = getGeminiApiKey(env);
  if (apiKey) {
    env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
    if (!env[EDISON_GEMINI_API_KEY_ENV]?.trim()) {
      env[EDISON_GEMINI_API_KEY_ENV] = apiKey;
    }
  }
}

export function isGeminiConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return getGeminiAuthMode(env) !== null;
}

ensureGeminiEnv();
