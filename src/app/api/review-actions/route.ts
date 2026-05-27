import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";

const reviewActionSchema = z.object({
  documentId: z.string().min(1),
  reviewer: z.string().min(1),
  decision: z.enum([
    "edited_transcription",
    "marked_uncertain",
    "corrected_metadata",
    "split_pages",
    "merged_pages",
    "flagged_manual_review",
    "approved",
    "rejected",
  ]),
  note: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = reviewActionSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: "Invalid review action payload.", issues: payload.error.issues },
        { status: 400 },
      );
    }

    await getEdisonService().recordReviewAction(payload.data);
    return NextResponse.json({ accepted: true }, { status: 201 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
