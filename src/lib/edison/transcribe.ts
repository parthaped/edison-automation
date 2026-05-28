import { generateText, Output } from "ai";
import { z } from "zod";
import { getActivePrompt, type TranscriptionPromptTask } from "./prompts";
import type { ConfidenceBucket, MetadataExtraction } from "./types";

// Multimodal OCR / HTR and metadata extraction via the Vercel AI Gateway.
// A plain "provider/model" string auto-routes through the gateway when
// AI_GATEWAY_API_KEY is set in the environment. No provider package is needed.

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
]);

const SUPPORTED_PDF_MIME_TYPE = "application/pdf";
// Vision-capable AI Gateway model slugs. Both can be overridden through the
// EDISON_OCR_MODEL and EDISON_METADATA_MODEL environment variables.
const DEFAULT_OCR_MODEL = "google/gemini-2.5-flash";
const DEFAULT_METADATA_MODEL = "google/gemini-2.5-flash-lite";
const DEFAULT_TIMEOUT_MS = 90_000;

export type TranscribableMediaType =
  | "image/jpeg"
  | "image/jpg"
  | "image/png"
  | "image/webp"
  | "image/gif"
  | "image/tiff"
  | "application/pdf";

export function isTranscribableMediaType(mimeType: string): boolean {
  const lower = mimeType.toLowerCase();
  return SUPPORTED_IMAGE_MIME_TYPES.has(lower) || lower === SUPPORTED_PDF_MIME_TYPE;
}

export function getDefaultOcrModel(env: NodeJS.ProcessEnv = process.env): string {
  return env.EDISON_OCR_MODEL ?? DEFAULT_OCR_MODEL;
}

export function getDefaultMetadataModel(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.EDISON_METADATA_MODEL ?? DEFAULT_METADATA_MODEL;
}

function getRequestTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.EDISON_AI_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function combineSignals(
  external: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("AI request timed out")), timeoutMs);
  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) {
      controller.abort(external.reason);
    } else {
      external.addEventListener("abort", onAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    },
  };
}

export interface TranscribeDocumentInput {
  bytes: Uint8Array;
  mediaType: string;
  model?: string;
  signal?: AbortSignal;
  promptTask?: TranscriptionPromptTask;
}

export interface TranscribeDocumentResult {
  ocrText: string;
  uncertainReadings: string[];
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
}

export async function transcribeDocument(
  input: TranscribeDocumentInput,
): Promise<TranscribeDocumentResult> {
  const mediaType = input.mediaType.toLowerCase();
  if (!isTranscribableMediaType(mediaType)) {
    throw new Error(
      `transcribeDocument was called with an unsupported media type: ${input.mediaType}.`,
    );
  }

  const model = input.model ?? getDefaultOcrModel();
  const activePrompt = getActivePrompt(input.promptTask ?? "diplomatic-transcription");
  const mediaPart =
    mediaType === SUPPORTED_PDF_MIME_TYPE
      ? ({
          type: "file" as const,
          data: input.bytes,
          mediaType: SUPPORTED_PDF_MIME_TYPE,
        } as const)
      : ({
          type: "image" as const,
          image: input.bytes,
          mediaType,
        } as const);

  const { signal, cleanup } = combineSignals(input.signal, getRequestTimeoutMs());
  try {
    const result = await generateText({
      model,
      abortSignal: signal,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: activePrompt.prompt }, mediaPart],
        },
      ],
    });

    const ocrText = result.text.trim();
    const uncertainReadings = ocrText.match(/\[[^\]]+\?\]/g) ?? [];

    return {
      ocrText,
      uncertainReadings,
      model,
      promptVersion: activePrompt.version,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    };
  } finally {
    cleanup();
  }
}

const metadataSchema = z.object({
  documentType: z
    .string()
    .describe(
      'Document type such as "correspondence", "telegram", "notebook page", "ledger", "memorandum", or "Unknown" if unclear.',
    ),
  date: z
    .string()
    .describe(
      'Document date as YYYY-MM-DD when fully known, YYYY-MM or YYYY when partial, or "Unknown".',
    ),
  authors: z
    .array(z.string())
    .describe(
      'People who wrote or signed the document. Use "Last, First" form. Empty array if none.',
    ),
  recipients: z
    .array(z.string())
    .describe(
      'People the document is addressed to. Use "Last, First" form. Empty array if none.',
    ),
  mentionedNames: z
    .array(z.string())
    .describe(
      "People, organizations, or places named in the body. Empty array if none.",
    ),
  subjects: z
    .array(z.string())
    .describe(
      "Short-form subject tags drawn from the text. 1-6 entries. Empty array if none.",
    ),
});

export interface ExtractMetadataInput {
  documentId: string;
  folderId: string;
  imageNames: string[];
  ocrText: string;
  confidence: ConfidenceBucket;
  model?: string;
  signal?: AbortSignal;
}

export interface ExtractMetadataResult {
  metadata: MetadataExtraction;
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
}

export async function extractMetadata(
  input: ExtractMetadataInput,
): Promise<ExtractMetadataResult> {
  const model = input.model ?? getDefaultMetadataModel();
  const activePrompt = getActivePrompt("metadata-extraction");

  if (input.ocrText.trim().length === 0) {
    return {
      metadata: emptyMetadata(input),
      model,
      promptVersion: activePrompt.version,
    };
  }

  const { signal, cleanup } = combineSignals(input.signal, getRequestTimeoutMs());
  try {
    const result = await generateText({
      model,
      abortSignal: signal,
      output: Output.object({ schema: metadataSchema }),
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: activePrompt.prompt },
            {
              type: "text",
              text: `Transcription to analyze:\n\n${input.ocrText}`,
            },
          ],
        },
      ],
    });

    return {
      metadata: {
        folderId: input.folderId,
        documentId: input.documentId,
        documentType: result.output.documentType || "Unknown",
        date: result.output.date || "Unknown",
        authors: result.output.authors ?? [],
        recipients: result.output.recipients ?? [],
        mentionedNames: result.output.mentionedNames ?? [],
        subjects: result.output.subjects ?? [],
        imageNames: input.imageNames,
        confidence: input.confidence,
      },
      model,
      promptVersion: activePrompt.version,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    };
  } finally {
    cleanup();
  }
}

function emptyMetadata(input: ExtractMetadataInput): MetadataExtraction {
  return {
    folderId: input.folderId,
    documentId: input.documentId,
    documentType: "Unknown",
    date: "Unknown",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: [],
    imageNames: input.imageNames,
    confidence: input.confidence,
  };
}
