import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ensureGeminiEnv,
  getGeminiApiKey,
  getGeminiAuthMode,
  getServiceAccountCredentials,
  getVertexProjectId,
  isGeminiConfigured,
  isVertexConfigured,
  normalizePrivateKey,
} from "./gemini-config";

describe("gemini-config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads EDISON_GEMINI_API_KEY", () => {
    vi.stubEnv("EDISON_GEMINI_API_KEY", " AIza_test ");
    expect(getGeminiApiKey()).toBe("AIza_test");
    expect(getGeminiAuthMode()).toBe("api-key");
    expect(isGeminiConfigured()).toBe(true);
  });

  it("detects Vertex service account configuration", () => {
    vi.stubEnv(
      "EDISON_GCP_SERVICE_ACCOUNT_JSON",
      JSON.stringify({
        type: "service_account",
        project_id: "edison-test",
        client_email: "bot@edison-test.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
      }),
    );
    vi.stubEnv("EDISON_GCP_PROJECT_ID", "edison-test");
    expect(getGeminiAuthMode()).toBe("vertex");
    expect(isVertexConfigured()).toBe(true);
    expect(getVertexProjectId()).toBe("edison-test");
    const credentials = getServiceAccountCredentials();
    expect(credentials?.client_email).toBe("bot@edison-test.iam.gserviceaccount.com");
    expect(credentials?.private_key).toContain("\n");
  });

  it("prefers Vertex over API key when both are set", () => {
    vi.stubEnv("EDISON_GEMINI_API_KEY", "AIza_test");
    vi.stubEnv(
      "EDISON_GCP_SERVICE_ACCOUNT_JSON",
      JSON.stringify({
        project_id: "edison-test",
        client_email: "bot@edison-test.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----\\n",
      }),
    );
    vi.stubEnv("EDISON_GCP_PROJECT_ID", "edison-test");
    expect(getGeminiAuthMode()).toBe("vertex");
  });

  it("mirrors Edison API key for AI SDK", () => {
    const env = {
      EDISON_GEMINI_API_KEY: "AIza_mirror",
    } as unknown as NodeJS.ProcessEnv;
    ensureGeminiEnv(env);
    expect(env.GOOGLE_GENERATIVE_AI_API_KEY).toBe("AIza_mirror");
  });

  it("normalizes escaped private key newlines", () => {
    expect(normalizePrivateKey("line1\\nline2")).toBe("line1\nline2");
  });
});
