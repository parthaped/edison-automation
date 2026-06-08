import { NextResponse } from "next/server";
import { getOcrQueueJob } from "@/lib/edison/ocr-queue-store";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = await getOcrQueueJob(jobId);
  if (!job) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ job });
}
