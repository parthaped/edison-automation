import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";

const querySchema = z.object({
  task: z
    .enum([
      "ocr-cleanup",
      "diplomatic-transcription",
      "normalized-transcription",
      "metadata-extraction",
      "summary",
      "consensus",
    ])
    .default("diplomatic-transcription"),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const payload = querySchema.safeParse({
      task: url.searchParams.get("task") ?? undefined,
    });
    if (!payload.success) {
      return NextResponse.json(
        { error: "Invalid improvement request.", issues: payload.error.issues },
        { status: 400 },
      );
    }

    const improvement = await getEdisonService().generateAgentImprovementDraft(
      payload.data.task,
    );
    return NextResponse.json(improvement);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
