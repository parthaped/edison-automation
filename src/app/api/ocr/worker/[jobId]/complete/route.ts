import { NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedOcrWorker } from "@/lib/edison/ocr-queue-auth";
import { completeOcrQueueJob, failOcrQueueJob } from "@/lib/edison/ocr-queue-store";

const completeBodySchema = z.object({
  pages: z.array(
    z.object({
      pageNumber: z.number().int().positive(),
      text: z.string(),
    }),
  ),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
});

const failBodySchema = z.object({
  error: z.string().min(1),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  if (!isAuthorizedOcrWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { jobId } = await context.params;
  const body: unknown = await request.json();

  try {
    if (failBodySchema.safeParse(body).success) {
      const failed = await failOcrQueueJob(
        jobId,
        failBodySchema.parse(body).error,
      );
      return NextResponse.json({ job: failed });
    }

    const parsed = completeBodySchema.parse(body);
    const job = await completeOcrQueueJob({
      jobId,
      pages: parsed.pages,
      model: parsed.model,
      promptVersion: parsed.promptVersion,
    });
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
