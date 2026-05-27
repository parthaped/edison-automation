import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";

const feedbackSchema = z.object({
  documentId: z.string().min(1),
  reviewer: z.string().min(1),
  target: z.enum(["transcription", "metadata", "confidence", "file-extraction", "prompt"]),
  originalValue: z.string(),
  correctedValue: z.string(),
  issueTags: z.array(z.string()).default([]),
  promptVersion: z.string().optional(),
  model: z.string().optional(),
  confidenceBefore: z.enum(["high", "medium", "low", "blocked"]).optional(),
  confidenceAfter: z.enum(["high", "medium", "low", "blocked"]).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = feedbackSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: "Invalid agent feedback payload.", issues: payload.error.issues },
        { status: 400 },
      );
    }

    const feedback = await getEdisonService().recordAgentFeedback(payload.data);
    return NextResponse.json({ feedback }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
