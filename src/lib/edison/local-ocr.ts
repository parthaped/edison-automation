import { z } from "zod";
import type { TranscribeDocumentInput, TranscribeDocumentResult } from "./transcribe";

const localOcrLineSchema = z.object({
  lineIndex: z.number(),
  bbox: z.array(z.number()).length(4).optional(),
  text: z.string(),
  confidence: z.number().optional(),
});

const localOcrPageSchema = z.object({
  pageIndex: z.number(),
  text: z.string(),
  lines: z.array(localOcrLineSchema).optional(),
});

const localOcrResponseSchema = z.object({
  ocrText: z.string().optional(),
  model: z.string(),
  promptVersion: z.string().optional(),
  uncertainReadings: z.array(z.string()).optional(),
  pages: z.array(localOcrPageSchema).optional(),
});

export type LocalOcrResponse = z.infer<typeof localOcrResponseSchema>;

function extractUncertainReadings(text: string): string[] {
  return [...new Set(text.match(/\[[^\]]+\?\]/g) ?? [])];
}

function flattenPages(response: LocalOcrResponse): string {
  if (response.ocrText?.trim()) {
    return response.ocrText.trim();
  }
  return (response.pages ?? [])
    .sort((left, right) => left.pageIndex - right.pageIndex)
    .map((page) => page.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

export function mapLocalOcrResponse(
  response: unknown,
): TranscribeDocumentResult {
  const parsed = localOcrResponseSchema.parse(response);
  const ocrText = flattenPages(parsed);
  const uncertainReadings =
    parsed.uncertainReadings ?? extractUncertainReadings(ocrText);
  const pageCount = parsed.pages?.length ?? 1;
  // Local OCR doesn't detect document boundaries; treat the whole upload as
  // a single sub-document so the workflow's persist step stays uniform.
  return {
    ocrText,
    uncertainReadings,
    model: parsed.model,
    promptVersion: parsed.promptVersion ?? "local-htr-v1",
    subDocuments: [
      {
        startPage: 1,
        endPage: Math.max(1, pageCount),
        ocrText,
        uncertainReadings,
        metadata: {
          title: "",
          documentType: "",
          date: "",
          authors: [],
          recipients: [],
          mentionedNames: [],
          subjects: [],
          places: [],
        },
      },
    ],
  };
}

export async function transcribeWithLocalOcr(
  input: TranscribeDocumentInput,
  endpoint: string,
  signal?: AbortSignal,
): Promise<TranscribeDocumentResult> {
  const formData = new FormData();
  const fileBytes = new ArrayBuffer(input.bytes.byteLength);
  new Uint8Array(fileBytes).set(input.bytes);
  formData.append(
    "file",
    new Blob([fileBytes], { type: input.mediaType }),
    "document",
  );
  formData.append("mediaType", input.mediaType);
  if (input.promptTask) {
    formData.append("promptTask", input.promptTask);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    body: formData,
    signal,
  });
  if (!response.ok) {
    throw new Error(`Local OCR request failed with ${response.status}.`);
  }
  return mapLocalOcrResponse(await response.json());
}
