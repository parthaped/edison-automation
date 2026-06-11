import { z } from "zod";
import { getGeminiAuthMode, isGeminiConfigured } from "./gemini-config";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OMEKA_API_BASE_URL: z.string().url().default("https://edisondigital.rutgers.edu/api"),
  DATABASE_URL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  EDISON_GEMINI_API_KEY: z.string().optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().optional(),
  EDISON_GCP_PROJECT_ID: z.string().optional(),
  EDISON_GCP_LOCATION: z.string().optional(),
  EDISON_OCR_MODEL: z.string().optional(),
  WORKBENCH_DEV_USERNAME: z.string().optional(),
  WORKBENCH_DEV_PASSWORD: z.string().optional(),
  WORKBENCH_SESSION_SECRET: z.string().optional(),
  SEARCH_AI_EXPANSION_ENABLED: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getAppEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}

export function getRuntimeCapabilities(
  env = getAppEnv(),
  source: NodeJS.ProcessEnv = process.env,
) {
  const gemini = isGeminiConfigured(source);
  const geminiAuthMode = getGeminiAuthMode(source);
  const transcriptionMode = gemini ? "gemini-vision" : "not-configured";
  return {
    storage: env.DATABASE_URL ? "database-configured" : "development-memory-store",
    files: env.BLOB_READ_WRITE_TOKEN ? "object-storage-configured" : "local-or-deferred-storage",
    ai: gemini ? "configured" : "not-configured",
    transcriptionMode,
    geminiAuthMode,
    omeka: env.OMEKA_API_BASE_URL ? "public-api-configured" : "not-configured",
  };
}
