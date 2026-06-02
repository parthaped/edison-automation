import { generateText, Output } from "ai";
import { z } from "zod";
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
}

export interface TranscribePageChunkResult {
  pages: Array<{ pageNumber: number; text: string }>;
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
}

const PAGE_CHUNK_INSTRUCTION =
  "Transcribe ONLY the page images provided in this request. Return one entry per page with the correct pageNumber. Do not infer content from pages you cannot see.";

export async function fetchImageBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch page image (${response.status}).`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export async function transcribePageChunk(
  input: TranscribePageChunkInput,
): Promise<TranscribePageChunkResult> {
  const model = input.model ?? getDefaultOcrModel();
  const activePrompt = getActivePrompt(
    input.promptTask ?? "diplomatic-transcription",
  );

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

  const result = await generateText({
    model,
    abortSignal: input.signal,
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
            text: `Index this ${input.totalPages}-page document for the Dublin Core catalog using the sample page and transcription excerpt. Base every field strictly on the document; use "Unknown" or empty arrays rather than guessing.\n\nTranscription excerpt:\n${excerpt}`,
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
    documentType: output.documentType || "Unknown",
    date: output.date || "Unknown",
    authors: output.authors ?? [],
    recipients: output.recipients ?? [],
    mentionedNames: output.mentionedNames ?? [],
    subjects: output.subjects ?? [],
  };
}

export function mergePageChunkResults(
  chunkResults: TranscribePageChunkResult[],
  totalPages: number,
  metadata: TranscribedMetadata,
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

  const subDocuments: SubDocumentResult[] = [
    {
      startPage: 1,
      endPage: totalPages,
      ocrText,
      uncertainReadings,
      metadata,
    },
  ];

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
