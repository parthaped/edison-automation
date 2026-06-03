import { generateText, Output } from "ai";
import { z } from "zod";
import { combineSignals, getRequestTimeoutMs } from "./ai-request";
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
  places: string[];
  comments?: string;
}

// One detected document inside the uploaded source. A PDF that contains
// three distinct letters returns three entries; a single-document upload
// returns one entry covering every page. `startPage`/`endPage` are 1-based
// inclusive page numbers in the source PDF.
export interface SubDocumentResult {
  startPage: number;
  endPage: number;
  ocrText: string;
  uncertainReadings: string[];
  metadata: TranscribedMetadata;
}

export interface TranscribeDocumentResult {
  // Aggregated OCR text across every sub-document. Preserved so legacy
  // callers (and the confidence grader) keep working unchanged.
  ocrText: string;
  uncertainReadings: string[];
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
  // Best-effort structured metadata for the *first* sub-document. Undefined
  // when the model returned no usable transcription text. The persist step
  // uses subDocuments[].metadata for per-sibling indexing; this legacy field
  // is kept so single-document call sites work unchanged.
  metadata?: TranscribedMetadata;
  // Always populated and length >= 1. Single-document uploads get one entry
  // covering every page. Multi-document PDFs get one entry per detected
  // document, in source-page order.
  subDocuments: SubDocumentResult[];
}

// Combined transcription + indexing + splitting schema. One model call now
// produces: (a) document boundary detection inside the PDF, (b) a full
// transcription per sub-document, and (c) Dublin Core metadata per
// sub-document. Folding all three into one call halves request volume vs.
// per-document indexing and avoids per-call rate-limit risk.
const subDocumentSchema = z.object({
  startPage: z
    .number()
    .int()
    .min(1)
    .describe(
      "1-based page number in the source PDF where this document starts (inclusive). For single-page images, set to 1.",
    ),
  endPage: z
    .number()
    .int()
    .min(1)
    .describe(
      "1-based page number in the source PDF where this document ends (inclusive). For a single-page document, equals startPage. Must be >= startPage.",
    ),
  transcription: z
    .string()
    .describe(
      "The full diplomatic transcription of THIS sub-document only in Edison Markdown v1: ## page headings per image filename; exact section labels (Letterhead:, Dateline:, To:, From:, Salutation:, Body:, Closing:, Signature:, Annotations:); GFM pipe tables for ledgers; bracket low-confidence readings with a trailing question mark; marginal notes under Annotations: in angle brackets with position in square brackets.",
    ),
  title: z
    .string()
    .describe(
      "A concise descriptive catalog title naming the principal correspondents or topic. Do not include the Doc ID or Folder ID. Leave empty when unclear.",
    ),
  documentType: z
    .string()
    .describe(
      'Document type from the TAEP list when applicable: "Letter", "Memorandum", "Telegram", "Report", "Publication", "Payroll Record", "Minutes", "Miscellaneous", "Questionnaire", "List", "Technical Note", "Notebook page", "Ledger", "Legal document", "Financial statement", "Drawing", "Printed material". Leave empty if it cannot be determined.',
    ),
  date: z
    .string()
    .describe(
      "Document date in ISO form: YYYY-MM-DD when the full date is known, YYYY-MM or YYYY when only partial. Leave empty when unknown. Never invent a date.",
    ),
  authors: z
    .array(z.string())
    .describe(
      'People or organizations who wrote or signed THIS sub-document, each as "Last, First Middle" (organizations written as-is). Empty array if none can be identified.',
    ),
  recipients: z
    .array(z.string())
    .describe(
      'People or organizations THIS sub-document is addressed to, each as "Last, First Middle". Empty array if none can be identified.',
    ),
  mentionedNames: z
    .array(z.string())
    .describe(
      'Other people and organizations named in the body that are not the author or recipient. People as "Last, First"; organizations as written. Do not include geographic places here. Empty array if none.',
    ),
  places: z
    .array(z.string())
    .describe(
      "Geographic places named in the document (cities, states, countries, regions). Empty array if none.",
    ),
  subjects: z
    .array(z.string())
    .describe(
      'One topical subject tag for this document (e.g. "Advice", "Telegraph", "Family", "Patents"). Not people, organizations, or places. Empty array if none.',
    ),
  comments: z
    .string()
    .describe(
      "Indexer notes: marginalia, attachments, conjectured authorship, cross-references. Leave empty if none.",
    ),
});

const combinedSchema = z.object({
  subDocuments: z
    .array(subDocumentSchema)
    .min(1)
    .describe(
      "One entry per distinct document detected in the source. If the source contains a single document (which is the common case), return exactly one entry covering every page. If the source is a stitched-together scan of N separate documents, return N entries — one per document — in source-page order with non-overlapping page ranges that together cover every page.",
    ),
});

const SPLIT_INSTRUCTION =
  "First, look at the source as a whole and decide whether it contains ONE document or MULTIPLE separate documents stitched together. Signals that mark a boundary between distinct documents include: a new letterhead, a new dateline, a new salutation/closing pair, an 'End of letter' marker, an explicit page-break separator, a blank or near-blank page, or an obvious change in handwriting/typography. If you see no such signals, treat the source as a single document and return exactly one entry covering every page. If you do see boundaries, return one sub-document entry per detected document, in source-page order, with contiguous and non-overlapping page ranges that cover every page of the source.";

const METADATA_INSTRUCTION =
  "For EACH sub-document, index it for the TAEP Omeka-S catalog: document type, date (ISO when known), author(s) and recipient(s) in last-name-first form, other names mentioned, geographic places, one topical subject, and indexer comments for marginalia or attachments. Separate multiple values within a field with semicolons in your reasoning, but return arrays in the structured fields. Base every field strictly on the document; leave a field empty rather than guessing.";

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
              text: `${activePrompt.prompt}\n\n${SPLIT_INSTRUCTION}\n\n${METADATA_INSTRUCTION}`,
            },
            mediaPart,
          ],
        },
      ],
    });

    const subDocuments: SubDocumentResult[] = (
      result.output.subDocuments ?? []
    )
      .slice()
      .sort((a, b) => a.startPage - b.startPage)
      .map((entry) => {
        const ocrText = (entry.transcription ?? "").trim();
        return {
          startPage: entry.startPage,
          endPage: Math.max(entry.startPage, entry.endPage),
          ocrText,
          uncertainReadings: ocrText.match(/\[[^\]]+\?\]/g) ?? [],
          metadata: {
            title: entry.title?.trim() || "",
            documentType: entry.documentType?.trim() || "",
            date: entry.date?.trim() || "",
            authors: entry.authors ?? [],
            recipients: entry.recipients ?? [],
            mentionedNames: entry.mentionedNames ?? [],
            subjects: entry.subjects ?? [],
            places: entry.places ?? [],
            comments: entry.comments?.trim() || undefined,
          },
        };
      });

    const aggregatedText = subDocuments
      .map((sub) => sub.ocrText)
      .filter(Boolean)
      .join("\n\n");
    const aggregatedUncertain = aggregatedText.match(/\[[^\]]+\?\]/g) ?? [];

    return {
      ocrText: aggregatedText,
      uncertainReadings: aggregatedUncertain,
      model,
      promptVersion: activePrompt.version,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      metadata:
        aggregatedText.length > 0 && subDocuments.length > 0
          ? subDocuments[0].metadata
          : undefined,
      subDocuments,
    };
  } finally {
    cleanup();
  }
}
