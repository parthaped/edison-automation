import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createVertex } from "@ai-sdk/google-vertex";
import type { LanguageModel } from "ai";
import {
  ensureGeminiEnv,
  getGeminiApiKey,
  getGeminiAuthMode,
  getServiceAccountCredentials,
  getVertexLocation,
  getVertexProjectId,
} from "./gemini-config";

export const DEFAULT_OCR_MODEL_ID = "gemini-2.5-flash";

/** Normalize `google/gemini-2.5-flash` or `gemini-2.5-flash` to a Gemini model id. */
export function normalizeGeminiModelId(
  model: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = (model ?? env.EDISON_OCR_MODEL ?? DEFAULT_OCR_MODEL_ID).trim();
  return raw.replace(/^google\//, "");
}

export function getDefaultOcrModelLabel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const id = normalizeGeminiModelId(undefined, env);
  return `google/${id}`;
}

export function resolveGeminiModel(
  model?: string,
  env: NodeJS.ProcessEnv = process.env,
): LanguageModel {
  const modelId = normalizeGeminiModelId(model, env);
  const authMode = getGeminiAuthMode(env);

  if (authMode === "vertex") {
    const project = getVertexProjectId(env);
    const credentials = getServiceAccountCredentials(env);
    if (!project || !credentials) {
      throw new Error(
        "Vertex AI is not fully configured. Set EDISON_GCP_PROJECT_ID and EDISON_GCP_SERVICE_ACCOUNT_JSON.",
      );
    }

    const vertex = createVertex({
      project,
      location: getVertexLocation(env),
      googleAuthOptions: {
        credentials,
      },
    });
    return vertex(modelId);
  }

  ensureGeminiEnv(env);
  const apiKey = getGeminiApiKey(env);
  if (!apiKey) {
    throw new Error(
      "Gemini is not configured. Set EDISON_GCP_SERVICE_ACCOUNT_JSON + EDISON_GCP_PROJECT_ID (Vertex), or EDISON_GEMINI_API_KEY (AI Studio).",
    );
  }

  const google = createGoogleGenerativeAI({ apiKey });
  return google(modelId);
}
