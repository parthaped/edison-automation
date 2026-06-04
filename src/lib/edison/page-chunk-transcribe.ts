import { generateText, Output } from "ai";
import { fetch } from "workflow";
import { z } from "zod";
import {
  combineSignals,
  getRequestTimeoutMs,
  isRateLimitError,
  isTransientError,
  rateLimitBackoffMs,
  retryBackoffMs,
  sleepMs,
} from "./ai-request";
import { reformatPageChunkWithGateway } from "./kraken-reformat";
import { transcribePagesWithLocalOcr } from "./local-ocr";
import { isLocalOcrEnabled } from "./ocr-provider";
import type { TranscriptionPromptTask } from "./prompts";
import { getActivePrompt } from "./prompts";
import {
  getDefaultOcrModel,
  type SubDocumentResult,
  type TranscribedMetadata,
  type TranscribeDocumentResult,
} from "./transcribe";

const pageChunkSchema = z.object({
  pages: z
    .array(
      z.object({
        pageNumber: z
          .number()
          .int()
          .min(1)
          .describe("1-based page number in the source PDF."),
        transcription: z
          .string()
          .describe(
            "Diplomatic transcription for this page only in Edison Markdown v1.",
          ),
      }),
    )
    .min(1),
});

const metadataOnlySchema = z.object({
  title: z.string(),
  documentType: z.string(),
  date: z.string(),
  authors: z.array(z.string()),
  recipients: z.array(z.string()),
  mentionedNames: z.array(z.string()),
  subjects: z.array(z.string()),
  places: z.array(z.string()),
  comments: z.string(),
});

const chunkedSubDocumentSchema = z.object({
  startPage: z
    .number()
    .int()
    .min(1)
    .describe("1-based page where this distinct document starts."),
  endPage: z
    .number()
    .int()
    .min(1)
    .describe("1-based page where this distinct document ends, inclusive."),
  title: z.string(),
  documentType: z.string(),
  date: z.string(),
  authors: z.array(z.string()),
  recipients: z.array(z.string()),
  mentionedNames: z.array(z.string()),
  subjects: z.array(z.string()),
  places: z.array(z.string()),
  comments: z.string(),
});

const chunkedStructureSchema = z.object({
  subDocuments: z
    .array(chunkedSubDocumentSchema)
    .min(1)
    .describe(
      "One entry per distinct document in source-page order. Ranges must be contiguous and cover every page.",
    ),
});

export interface PageImageRef {
  pageNumber: number;
  url: string;
}

export interface TranscribePageChunkInput {
  pages: PageImageRef[];
  promptTask?: TranscriptionPromptTask;
  model?: string;
  signal?: AbortSignal;
  /** Used for Edison Markdown ## page headings during Kraken→Gemini reformat. */
  documentId?: string;
}

export interface TranscribePageChunkResult {
  pages: Array<{ pageNumber: number; text: string }>;
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface ChunkedSubDocumentPlan {
  startPage: number;
  endPage: number;
  metadata: TranscribedMetadata;
}

const PAGE_CHUNK_INSTRUCTION =
  "Transcribe ONLY the page images provided in this request. Return one entry per page with the correct pageNumber. Do not infer content from pages you cannot see.";

const CHUNKED_SPLIT_INSTRUCTION =
  "You are given OCR text for every page of a source PDF. Decide whether the source contains ONE document or MULTIPLE separate documents stitched together. Boundary signals include new letterhead, new dateline, new salutation/closing pair, explicit end markers, blank separator pages, or obvious changes in subject/format. Return contiguous, non-overlapping page ranges that cover every page. If uncertain, prefer fewer splits.";

export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch page image (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

const MAX_CHUNK_ATTEMPTS = 3;

export function findMissingPagesInChunkResult(
  requested: PageImageRef[],
  result: TranscribePageChunkResult,
): number[] {
  const seen = new Set(result.pages.map((page) => page.pageNumber));
  return requested
    .map((page) => page.pageNumber)
    .filter((pageNumber) => !seen.has(pageNumber));
}

function mergeChunkResults(
  left: TranscribePageChunkResult,
  right: TranscribePageChunkResult,
): TranscribePageChunkResult {
  const inputTokens = (left.inputTokens ?? 0) + (right.inputTokens ?? 0);
  const outputTokens = (left.outputTokens ?? 0) + (right.outputTokens ?? 0);
  return {
    pages: [...left.pages, ...right.pages].sort(
      (a, b) => a.pageNumber - b.pageNumber,
    ),
    model: left.model,
    promptVersion: left.promptVersion,
    inputTokens: inputTokens > 0 ? inputTokens : undefined,
    outputTokens: outputTokens > 0 ? outputTokens : undefined,
  };
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function transcribePageChunk(
  input: TranscribePageChunkInput,
): Promise<TranscribePageChunkResult> {
  const promptTask = input.promptTask ?? "diplomatic-transcription";

  if (isLocalOcrEnabled()) {
    const pageBytes = await Promise.all(
      input.pages.map(async (page) => ({
        pageNumber: page.pageNumber,
        bytes: await fetchImageBytes(page.url),
        mediaType: "image/jpeg" as const,
      })),
    );
    const krakenResult = await transcribePagesWithLocalOcr({
      pages: pageBytes,
      promptTask,
      signal: input.signal,
    });
    return reformatPageChunkWithGateway(krakenResult, {
      promptTask,
      documentId: input.documentId,
      signal: input.signal,
    });
  }

  const model = input.model ?? getDefaultOcrModel();
  const activePrompt = getActivePrompt(promptTask);

  const imageParts = await Promise.all(
    input.pages.map(async (page) => {
      const bytes = await fetchImageBytes(page.url);
      return {
        type: "image" as const,
        image: bytes,
        mediaType: "image/jpeg" as const,
      };
    }),
  );

  const { signal, cleanup } = combineSignals(
    input.signal,
    getRequestTimeoutMs(),
  );
  try {
    const result = await generateText({
      model,
      abortSignal: signal,
      output: Output.object({ schema: pageChunkSchema }),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${activePrompt.prompt}\n\n${PAGE_CHUNK_INSTRUCTION}\n\nPages in this batch: ${input.pages.map((p) => p.pageNumber).join(", ")}.`,
            },
            ...imageParts,
          ],
        },
      ],
    });

    return {
      pages: (result.output.pages ?? [])
        .slice()
        .sort((a, b) => a.pageNumber - b.pageNumber)
        .map((entry) => ({
          pageNumber: entry.pageNumber,
          text: (entry.transcription ?? "").trim(),
        })),
      model,
      promptVersion: activePrompt.version,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    };
  } finally {
    cleanup();
  }
}

export type TranscribePageChunkFn = (
  input: TranscribePageChunkInput,
) => Promise<TranscribePageChunkResult>;

export interface TranscribePageChunkResilientOptions {
  /** Override for tests; defaults to transcribePageChunk. */
  transcribe?: TranscribePageChunkFn;
}

export async function transcribePageChunkResilient(
  input: TranscribePageChunkInput,
  options: TranscribePageChunkResilientOptions = {},
): Promise<TranscribePageChunkResult> {
  const transcribe = options.transcribe ?? transcribePageChunk;
  if (input.pages.length === 0) {
    throw new Error("transcribePageChunkResilient requires at least one page.");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_CHUNK_ATTEMPTS; attempt++) {
    try {
      const result = await transcribe(input);
      const missing = findMissingPagesInChunkResult(input.pages, result);
      if (missing.length === 0) {
        return result;
      }
      lastError = new Error(`Model omitted pages: ${missing.join(", ")}`);
    } catch (error) {
      lastError = error;
    }

    const err = toError(lastError);
    const rateLimited = isRateLimitError(err);
    const canRetry =
      attempt < MAX_CHUNK_ATTEMPTS - 1 &&
      (isTransientError(err) ||
        err.message.toLowerCase().includes("omitted pages"));
    if (canRetry) {
      await sleepMs(
        rateLimited ? rateLimitBackoffMs(attempt) : retryBackoffMs(attempt),
      );
      continue;
    }
    break;
  }

  const err = toError(lastError);
  if (isRateLimitError(err) && !isLocalOcrEnabled()) {
    throw err;
  }

  if (input.pages.length === 1) {
    throw err;
  }

  const mid = Math.ceil(input.pages.length / 2);
  const left = await transcribePageChunkResilient(
    {
      ...input,
      pages: input.pages.slice(0, mid),
    },
    options,
  );
  const right = await transcribePageChunkResilient(
    {
      ...input,
      pages: input.pages.slice(mid),
    },
    options,
  );
  return mergeChunkResults(left, right);
}

export async function extractDocumentMetadataFromSample(input: {
  samplePageUrl: string;
  mergedTextExcerpt: string;
  totalPages: number;
  model?: string;
  signal?: AbortSignal;
}): Promise<TranscribedMetadata> {
  const model = input.model ?? getDefaultOcrModel();
  const bytes = await fetchImageBytes(input.samplePageUrl);
  const excerpt = input.mergedTextExcerpt.slice(0, 8000);

  const result = await generateText({
    model,
    abortSignal: input.signal,
    output: Output.object({ schema: metadataOnlySchema }),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Index this ${input.totalPages}-page document for the TAEP Omeka-S catalog using the sample page and transcription excerpt. Extract document type, date, authors, recipients, names mentioned, places, subjects, and comments. Leave fields empty rather than guessing.\n\nTranscription excerpt:\n${excerpt}`,
          },
          {
            type: "image",
            image: bytes,
            mediaType: "image/jpeg",
          },
        ],
      },
    ],
  });

  const output = result.output;
  return {
    title: output.title?.trim() || "",
    documentType: output.documentType?.trim() || "",
    date: output.date?.trim() || "",
    authors: output.authors ?? [],
    recipients: output.recipients ?? [],
    mentionedNames: output.mentionedNames ?? [],
    subjects: output.subjects ?? [],
    places: output.places ?? [],
    comments: output.comments?.trim() || undefined,
  };
}

export async function analyzeChunkedDocumentStructure(input: {
  pages: Array<{ pageNumber: number; text: string }>;
  totalPages: number;
  promptTask?: TranscriptionPromptTask;
  model?: string;
  signal?: AbortSignal;
}): Promise<ChunkedSubDocumentPlan[]> {
  const model = input.model ?? getDefaultOcrModel();
  const activePrompt = getActivePrompt(
    input.promptTask ?? "diplomatic-transcription",
  );
  const pageText = input.pages
    .map((page) => {
      const text = page.text.trim() || "[No legible text returned for this page]";
      return `--- PAGE ${page.pageNumber} ---\n${text.slice(0, 5000)}`;
    })
    .join("\n\n");

  const result = await generateText({
    model,
    abortSignal: input.signal,
    output: Output.object({ schema: chunkedStructureSchema }),
    messages: [
      {
        role: "user",
        content: `${activePrompt.prompt}\n\n${CHUNKED_SPLIT_INSTRUCTION}\n\nFor EACH returned sub-document, also index it for the TAEP Omeka-S catalog. Leave fields empty rather than guessing.\n\nTotal pages: ${input.totalPages}\n\n${pageText}`,
      },
    ],
  });

  return (result.output.subDocuments ?? [])
    .slice()
    .sort((a, b) => a.startPage - b.startPage)
    .map((entry) => ({
      startPage: entry.startPage,
      endPage: Math.max(entry.startPage, entry.endPage),
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
    }));
}

export function mergePageChunkResults(
  chunkResults: TranscribePageChunkResult[],
  totalPages: number,
  metadata: TranscribedMetadata,
  subDocumentPlans?: ChunkedSubDocumentPlan[],
): TranscribeDocumentResult {
  const textByPage = new Map<number, string>();
  for (const chunk of chunkResults) {
    for (const page of chunk.pages) {
      textByPage.set(page.pageNumber, page.text);
    }
  }

  const orderedPages = Array.from({ length: totalPages }, (_, index) => {
    const pageNumber = index + 1;
    return {
      pageNumber,
      text: textByPage.get(pageNumber) ?? "",
    };
  });

  const ocrText = orderedPages
    .map((page) => page.text)
    .filter(Boolean)
    .join("\n\n");
  const uncertainReadings = ocrText.match(/\[[^\]]+\?\]/g) ?? [];

  const plans = normalizeChunkedPlans(
    subDocumentPlans && subDocumentPlans.length > 0
      ? subDocumentPlans
      : [{ startPage: 1, endPage: totalPages, metadata }],
    totalPages,
    metadata,
  );

  const subDocuments: SubDocumentResult[] = plans.map((plan) => {
    const startPage = Math.max(1, Math.min(plan.startPage, totalPages));
    const endPage = Math.max(startPage, Math.min(plan.endPage, totalPages));
    const documentText = orderedPages
      .filter(
        (page) => page.pageNumber >= startPage && page.pageNumber <= endPage,
      )
      .map((page) => page.text)
      .filter(Boolean)
      .join("\n\n");
    return {
      startPage,
      endPage,
      ocrText: documentText,
      uncertainReadings: documentText.match(/\[[^\]]+\?\]/g) ?? [],
      metadata: plan.metadata,
    };
  });

  const model = chunkResults[0]?.model ?? getDefaultOcrModel();
  const promptVersion = chunkResults[0]?.promptVersion ?? "unknown";
  const inputTokens = chunkResults.reduce(
    (sum, chunk) => sum + (chunk.inputTokens ?? 0),
    0,
  );
  const outputTokens = chunkResults.reduce(
    (sum, chunk) => sum + (chunk.outputTokens ?? 0),
    0,
  );

  return {
    ocrText,
    uncertainReadings,
    model,
    promptVersion,
    inputTokens: inputTokens || undefined,
    outputTokens: outputTokens || undefined,
    metadata: ocrText.length > 0 ? metadata : undefined,
    subDocuments,
  };
}

function normalizeChunkedPlans(
  plans: ChunkedSubDocumentPlan[],
  totalPages: number,
  fallbackMetadata: TranscribedMetadata,
): ChunkedSubDocumentPlan[] {
  const sorted = plans
    .map((plan) => ({
      ...plan,
      startPage: Math.max(1, Math.min(plan.startPage, totalPages)),
      endPage: Math.max(1, Math.min(plan.endPage, totalPages)),
    }))
    .filter((plan) => plan.endPage >= plan.startPage)
    .sort((a, b) => a.startPage - b.startPage);

  const normalized: ChunkedSubDocumentPlan[] = [];
  let cursor = 0;
  for (const plan of sorted) {
    if (plan.endPage <= cursor) continue;
    normalized.push({
      ...plan,
      startPage: cursor + 1,
      endPage: plan.endPage,
    });
    cursor = plan.endPage;
  }

  if (normalized.length === 0) {
    return [{ startPage: 1, endPage: totalPages, metadata: fallbackMetadata }];
  }

  if (cursor < totalPages) {
    const last = normalized[normalized.length - 1];
    normalized[normalized.length - 1] = { ...last, endPage: totalPages };
  }

  return normalized;
}
