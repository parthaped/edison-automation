import { z } from "zod";
import { extractUncertainReadings } from "./confidence";
import { getLocalOcrSecret, getLocalOcrUrl } from "./local-ocr-config";
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
    promptVersion: parsed.promptVersion ?? "local-qwen-vl-v1",
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

function localOcrHeaders(env: NodeJS.ProcessEnv = process.env): HeadersInit {
  const secret = getLocalOcrSecret(env);
  if (!secret) {
    return {};
  }
  return { "X-Edison-Ocr-Secret": secret };
}

async function postLocalOcr(
  endpoint: string,
  bytes: Uint8Array,
  mediaType: string,
  signal?: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalOcrResponse> {
  const formData = new FormData();
  const fileBytes = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(fileBytes).set(bytes);
  formData.append(
    "file",
    new Blob([fileBytes], { type: mediaType }),
    "document",
  );
  formData.append("mediaType", mediaType);

  const response = await fetch(endpoint, {
    method: "POST",
    headers: localOcrHeaders(env),
    body: formData,
    signal,
  });
  if (!response.ok) {
    throw new Error(`Local OCR request failed with ${response.status}.`);
  }
  return localOcrResponseSchema.parse(await response.json());
}

/** Transcribe one page image via the remote Qwen / HTTP OCR service. */
export async function transcribePageImageWithLocalOcr(input: {
  bytes: Uint8Array;
  mediaType?: string;
  endpoint?: string;
  signal?: AbortSignal;
}): Promise<{ text: string; model: string; promptVersion: string }> {
  const endpoint = input.endpoint ?? getLocalOcrUrl();
  if (!endpoint) {
    throw new Error("EDISON_LOCAL_OCR_URL is not configured.");
  }
  const parsed = await postLocalOcr(
    endpoint,
    input.bytes,
    input.mediaType ?? "image/jpeg",
    input.signal,
  );
  const text = flattenPages(parsed);
  return {
    text,
    model: parsed.model,
    promptVersion: parsed.promptVersion ?? "local-qwen-vl-v1",
  };
}

export async function transcribeWithLocalOcr(
  input: TranscribeDocumentInput,
  endpoint: string,
  signal?: AbortSignal,
): Promise<TranscribeDocumentResult> {
  const parsed = await postLocalOcr(
    endpoint,
    input.bytes,
    input.mediaType,
    signal,
  );
  return mapLocalOcrResponse(parsed);
}
