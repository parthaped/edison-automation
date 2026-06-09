import { generateText, Output } from "ai";
import { z } from "zod";
import { combineSignals, getRequestTimeoutMs } from "./ai-request";
import { getDefaultOcrModelLabel, resolveGeminiModel } from "./gemini-model";
import { buildImageFilename } from "./id-policy";
import { getPageChunkSize, partitionPageRanges } from "./ingest-policy";
import { getActivePrompt, type TranscriptionPromptTask } from "./prompts";

const formattedPageSchema = z.object({
  pages: z
    .array(
      z.object({
        pageNumber: z.number().int().min(1),
        transcription: z.string(),
      }),
    )
    .min(1),
});

const FORMAT_INSTRUCTION = `You are given raw OCR text extracted by a local engine (not your own reading of the manuscript).

Rules:
- Preserve the OCR wording. Do NOT re-transcribe from memory or substitute better guesses.
- Only fix layout and formatting to Edison Markdown v1.
- Do not invent content that is not present in the OCR text.
- You may fix obvious spacing or line-break artifacts introduced by OCR.`;

export interface FormatOcrPageInput {
  pageNumber: number;
  text: string;
}

export interface FormatOcrTranscriptionInput {
  documentId: string;
  folderId: string;
  pages: FormatOcrPageInput[];
  promptTask?: TranscriptionPromptTask;
  model?: string;
  signal?: AbortSignal;
}

export interface FormatOcrTranscriptionResult {
  pages: Array<{ pageNumber: number; text: string }>;
  model: string;
  promptVersion: string;
  inputTokens?: number;
  outputTokens?: number;
}

function pagePayload(
  folderId: string,
  pages: FormatOcrPageInput[],
): string {
  return pages
    .map((page) => {
      const imageFilename = buildImageFilename(folderId, page.pageNumber);
      const text = page.text.trim() || "[No legible OCR text for this page]";
      return `--- PAGE ${page.pageNumber} (${imageFilename}) ---\n${text.slice(0, 8000)}`;
    })
    .join("\n\n");
}

async function formatPageBatch(
  input: FormatOcrTranscriptionInput,
  batch: FormatOcrPageInput[],
): Promise<FormatOcrTranscriptionResult> {
  const promptTask = input.promptTask ?? "diplomatic-transcription";
  const modelLabel = input.model ?? getDefaultOcrModelLabel();
  const activePrompt = getActivePrompt(promptTask);
  const { signal, cleanup } = combineSignals(
    input.signal,
    getRequestTimeoutMs(),
  );

  try {
    const result = await generateText({
      model: resolveGeminiModel(modelLabel),
      abortSignal: signal,
      output: Output.object({ schema: formattedPageSchema }),
      messages: [
        {
          role: "user",
          content: `${FORMAT_INSTRUCTION}\n\n${activePrompt.prompt}\n\nDoc ID: ${input.documentId}\nFolder ID: ${input.folderId}\n\nPages in this batch: ${batch.map((page) => page.pageNumber).join(", ")}\n\n${pagePayload(input.folderId, batch)}`,
        },
      ],
    });

    const byPage = new Map<number, string>();
    for (const entry of result.output.pages ?? []) {
      byPage.set(entry.pageNumber, (entry.transcription ?? "").trim());
    }

    return {
      pages: batch.map((page) => ({
        pageNumber: page.pageNumber,
        text: byPage.get(page.pageNumber) ?? page.text.trim(),
      })),
      model: modelLabel,
      promptVersion: `${activePrompt.version}-format`,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
    };
  } finally {
    cleanup();
  }
}

export async function formatOcrTranscriptionWithGemini(
  input: FormatOcrTranscriptionInput,
): Promise<FormatOcrTranscriptionResult> {
  if (input.pages.length === 0) {
    throw new Error("formatOcrTranscriptionWithGemini requires at least one page.");
  }

  const chunkSize = getPageChunkSize();
  const ranges = partitionPageRanges(input.pages.length, chunkSize);
  const pageByNumber = new Map(
    input.pages.map((page) => [page.pageNumber, page.text]),
  );

  const batches: FormatOcrPageInput[][] = ranges.map((range) =>
    Array.from({ length: range.endPage - range.startPage + 1 }, (_, offset) => {
      const pageNumber = range.startPage + offset;
      return {
        pageNumber,
        text: pageByNumber.get(pageNumber) ?? "",
      };
    }),
  );

  let merged: FormatOcrTranscriptionResult | null = null;
  for (const batch of batches) {
    const result = await formatPageBatch(input, batch);
    if (!merged) {
      merged = result;
      continue;
    }
    merged = {
      pages: [...merged.pages, ...result.pages].sort(
        (left, right) => left.pageNumber - right.pageNumber,
      ),
      model: result.model,
      promptVersion: result.promptVersion,
      inputTokens: (merged.inputTokens ?? 0) + (result.inputTokens ?? 0),
      outputTokens: (merged.outputTokens ?? 0) + (result.outputTokens ?? 0),
    };
  }

  return merged ?? formatPageBatch(input, input.pages);
}
