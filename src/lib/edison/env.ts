import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  OMEKA_API_BASE_URL: z.string().url().default("https://edisondigital.rutgers.edu/api"),
  DATABASE_URL: z.string().optional(),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  BOX_CLIENT_ID: z.string().optional(),
  BOX_CLIENT_SECRET: z.string().optional(),
  BOX_ENTERPRISE_ID: z.string().optional(),
  BOX_WEBHOOK_SECRET: z.string().optional(),
  AI_GATEWAY_API_KEY: z.string().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

export function getAppEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  return envSchema.parse(source);
}

export function getRuntimeCapabilities(
  env = getAppEnv(),
  source: NodeJS.ProcessEnv = process.env,
) {
  const localOcr = Boolean(source.EDISON_LOCAL_OCR_URL?.trim());
  const gateway = Boolean(env.AI_GATEWAY_API_KEY?.trim());
  return {
    storage: env.DATABASE_URL ? "database-configured" : "development-memory-store",
    files: env.BLOB_READ_WRITE_TOKEN ? "object-storage-configured" : "local-or-deferred-storage",
    box: env.BOX_CLIENT_ID && env.BOX_CLIENT_SECRET ? "configured" : "not-configured",
    ai:
      gateway || localOcr
        ? localOcr && !gateway
          ? "local-ocr-configured"
          : localOcr && gateway
            ? "local-ocr-and-gateway-configured"
            : "configured"
        : "not-configured",
    localOcr: localOcr ? "configured" : "not-configured",
    omeka: env.OMEKA_API_BASE_URL ? "public-api-configured" : "not-configured",
  };
}
