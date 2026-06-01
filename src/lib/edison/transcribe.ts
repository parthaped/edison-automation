import { generateText, Output } from "ai";
import { z } from "zod";
import { transcribeWithLocalOcr } from "./local-ocr";
import { getActivePrompt, type TranscriptionPromptTask } from "./prompts";

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
// Vision-capable AI Gateway model slug. Overridable through the
// EDISON_OCR_MODEL environment variable. A single call now produces both the
// transcription and the structured metadata.
const DEFAULT_OCR_MODEL = "google/gemini-2.5-flash";
// Must stay below the serverless function ceiling (60s on the Hobby plan) so a
// slow model call aborts cleanly and is caught as a retryable error instead of
// the platform killing the whole step mid-request. Override with
// EDISON_AI_TIMEOUT_MS on plans with a larger maxDuration.
const DEFAULT_TIMEOUT_MS = 45_000;

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

function getLocalOcrUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return env.EDISON_LOCAL_OCR_URL?.trim() || undefined;
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

// Structured metadata fields extracted alongside the transcription in the same
// model call. The caller assembles these into a full MetadataExtraction by
// adding folderId / documentId / imageNames / confidence.
export interface TranscribedMetadata {
  title: string;
  documentType: string;
  date: string;
  authors: string[];
  recipients: string[];
  mentionedNames: string[];
  subjects: string[];
}

export interface TranscribeDocumentResult {
  ocrText: string;
  uncertainReadings: string[];
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  // Best-effort structured metadata produced in the same call. Undefined when
  // the model returned no usable transcription text.
  metadata?: TranscribedMetadata;
}

// Combined transcription + indexing schema. Folding both into a single model
// call halves request volume (one call per file instead of two), which keeps
// the free-tier rate limit far out of reach, and metadata can never fail a
// file on its own because it rides along with the transcription response.
const combinedSchema = z.object({
  transcription: z
    .string()
    .describe(
      "The full diplomatic transcription following every formatting rule in the instructions above. Use the document's own paragraphing, punctuation, and underlining; bracket low-confidence readings with a trailing question mark; place annotations and marginal notes at the end.",
    ),
  title: z
    .string()
    .describe(
      "A concise descriptive catalog title for the document, naming the principal correspondents or topic (e.g. \"Marks, William D. to Edison, Thomas A.\" or \"Notebook entry on lamp filament tests\"). Do not include the Doc ID or Folder ID. Use \"Unknown\" only when the document is illegible.",
    ),
  documentType: z
    .string()
    .describe(
      'Single document type, lowercase, from this controlled list when applicable: "correspondence", "telegram", "notebook page", "ledger", "memorandum", "legal document", "financial statement", "drawing", "printed material". Use "Unknown" only if it cannot be determined.',
    ),
  date: z
    .string()
    .describe(
      'Document date in ISO form: YYYY-MM-DD when the full date is known, YYYY-MM or YYYY when only partial, or "Unknown". Never invent a date that is not supported by the document.',
    ),
  authors: z
    .array(z.string())
    .describe(
      'People or organizations who wrote or signed the document, each as "Last, First Middle" (organizations written as-is). Empty array if none can be identified.',
    ),
  recipients: z
    .array(z.string())
    .describe(
      'People or organizations the document is addressed to, each as "Last, First Middle". Empty array if none can be identified.',
    ),
  mentionedNames: z
    .array(z.string())
    .describe(
      'People, organizations, or places named in the body that are not the author or recipient. People as "Last, First"; organizations and places as written. Empty array if none.',
    ),
  subjects: z
    .array(z.string())
    .describe(
      "1-6 concrete topical subject tags drawn from the document content (e.g. \"electric lighting\", \"patent litigation\", \"phonograph\"). Prefer specific Edison-domain topics over generic words. Empty array if none can be determined; never use placeholder text.",
    ),
});

const METADATA_INSTRUCTION =
  "After transcribing, index the document for the Dublin Core catalog: a descriptive title, the document type, the date (ISO Year-Month-Day when known), the author(s) and recipient(s) in last-name-first form, other names mentioned, and a few concrete topical subject tags. Base every field strictly on the document; leave a field empty or \"Unknown\" rather than guessing. Return everything in the structured fields provided.";

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

  const localOcrUrl = getLocalOcrUrl();
  if (localOcrUrl) {
    const { signal, cleanup } = combineSignals(input.signal, getRequestTimeoutMs());
    try {
      return await transcribeWithLocalOcr(input, localOcrUrl, signal);
    } finally {
      cleanup();
    }
  }

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
      output: Output.object({ schema: combinedSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${activePrompt.prompt}\n\n${METADATA_INSTRUCTION}`,
            },
            mediaPart,
          ],
        },
      ],
    });

    const ocrText = (result.output.transcription ?? "").trim();
    const uncertainReadings = ocrText.match(/\[[^\]]+\?\]/g) ?? [];

    return {
      ocrText,
      uncertainReadings,
      model,
      promptVersion: activePrompt.version,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      metadata:
        ocrText.length > 0
          ? {
              title: result.output.title || "",
              documentType: result.output.documentType || "Unknown",
              date: result.output.date || "Unknown",
              authors: result.output.authors ?? [],
              recipients: result.output.recipients ?? [],
              mentionedNames: result.output.mentionedNames ?? [],
              subjects: result.output.subjects ?? [],
            }
          : undefined,
    };
  } finally {
    cleanup();
  }
}
