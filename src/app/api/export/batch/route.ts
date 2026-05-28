import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

const confidenceBucket = z.enum(["high", "medium", "low", "blocked"]);
const processingStatus = z.enum([
  "queued",
  "extracting",
  "transcribing",
  "needs_review",
  "approved",
  "exported",
  "blocked",
]);

const sourceFileSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number(),
  mimeType: z.string(),
  boxFileId: z.string().optional(),
  checksum: z.string().optional(),
});

const pageImageSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  pageIndex: z.number(),
  imageFilename: z.string(),
  sourcePage: z.number(),
  checksum: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  omekaMediaId: z.number().optional(),
  originalUrl: z.string().optional(),
});

const documentPackageSchema = z.object({
  id: z.string(),
  folderId: z.string(),
  documentId: z.string(),
  title: z.string(),
  sourceFile: sourceFileSchema,
  pages: z.array(pageImageSchema),
  status: processingStatus,
  confidence: confidenceBucket,
  validationWarnings: z.array(z.string()),
  uncertaintyNotes: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const transcriptionRunSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  ocrText: z.string(),
  diplomaticText: z.string(),
  normalizedText: z.string().optional(),
  uncertainReadings: z.array(z.string()),
  costUsd: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
});

const metadataExtractionSchema = z.object({
  folderId: z.string(),
  documentId: z.string(),
  documentType: z.string(),
  date: z.string(),
  authors: z.array(z.string()),
  recipients: z.array(z.string()),
  mentionedNames: z.array(z.string()),
  subjects: z.array(z.string()),
  imageNames: z.array(z.string()),
  confidence: confidenceBucket,
});

const batchExportPayloadSchema = z.object({
  packages: z.array(documentPackageSchema).min(1),
  transcriptions: z.array(transcriptionRunSchema),
  metadata: z.array(metadataExtractionSchema),
});

function zipResponse(result: {
  bytes: Uint8Array;
  fileName: string;
  documentCount: number;
}) {
  return new NextResponse(result.bytes as unknown as BodyInit, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${result.fileName}"`,
      "x-edison-document-count": String(result.documentCount),
    },
  });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const ids = parseIds(url.searchParams.get("ids"));
    const result = await getEdisonService().buildBatchExport(ids);
    return zipResponse(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    const payload = batchExportPayloadSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: "Invalid batch export payload.", issues: payload.error.issues },
        { status: 400 },
      );
    }
    const result = await getEdisonService().buildBatchExportFromPayload(
      payload.data,
    );
    return zipResponse(result);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
