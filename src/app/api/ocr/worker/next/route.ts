import { NextResponse } from "next/server";
import { isAuthorizedOcrWorker } from "@/lib/edison/ocr-queue-auth";
import { claimNextOcrQueueJob } from "@/lib/edison/ocr-queue-store";

export async function GET(request: Request) {
  if (!isAuthorizedOcrWorker(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerId =
    request.headers.get("x-edison-ocr-worker-id")?.trim() || "amarel-worker";
  const job = await claimNextOcrQueueJob(workerId);
  if (!job) {
    return NextResponse.json({ job: null });
  }
  return NextResponse.json({ job });
}
