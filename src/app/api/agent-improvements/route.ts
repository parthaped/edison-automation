import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";

const taskSchema = z.enum([
  "ocr-cleanup",
  "diplomatic-transcription",
  "normalized-transcription",
  "metadata-extraction",
  "summary",
  "consensus",
]);

const querySchema = z.object({
  task: taskSchema.default("diplomatic-transcription"),
});

const bodySchema = z.object({
  task: taskSchema.default("diplomatic-transcription"),
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

    const preview = await getEdisonService().previewAgentImprovementDraft(
      payload.data.task,
    );
    return NextResponse.json(preview);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

export async function POST(request: Request) {
  try {
    let parsed: unknown = {};
    try {
      parsed = await request.json();
    } catch {
      parsed = {};
    }
    const payload = bodySchema.safeParse(parsed);
    if (!payload.success) {
      return NextResponse.json(
        { error: "Invalid improvement request.", issues: payload.error.issues },
        { status: 400 },
      );
    }

    const improvement = await getEdisonService().generateAgentImprovementDraft(
      payload.data.task,
    );
    return NextResponse.json(improvement, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
