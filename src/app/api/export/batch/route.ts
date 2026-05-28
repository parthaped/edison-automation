import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import type { BatchExportPayload } from "@/lib/edison/service";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";
export const maxDuration = 60;

// Surface validation is intentionally light: the upload form is the only
// caller and ships payloads shaped from our own typed models. We only assert
// the top-level structure so a malformed request returns 400 instead of 500.
const payloadShape = z
  .object({
    packages: z.array(z.unknown()).min(1),
    transcriptions: z.array(z.unknown()).default([]),
    metadata: z.array(z.unknown()).default([]),
  })
  .passthrough();

export async function POST(request: Request) {
  try {
    const parsed = payloadShape.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid batch export payload.", issues: parsed.error.issues },
        { status: 400 },
      );
    }
    const result = await getEdisonService().buildBatchExportFromPayload(
      parsed.data as unknown as BatchExportPayload,
    );
    return new NextResponse(result.bytes as unknown as BodyInit, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${result.fileName}"`,
        "x-edison-document-count": String(result.documentCount),
      },
    });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
