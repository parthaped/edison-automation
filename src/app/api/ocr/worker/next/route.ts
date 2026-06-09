import { NextResponse } from "next/server";
import { isAuthorizedOcrWorker } from "@/lib/edison/ocr-queue-auth";
import {
  getOcrWorkerSecret,
  isOcrQueueEnabled,
} from "@/lib/edison/ocr-queue-config";
import { claimNextOcrQueueJob } from "@/lib/edison/ocr-queue-store";

export async function GET(request: Request) {
  if (!isOcrQueueEnabled()) {
    return NextResponse.json(
      {
        error:
          "OCR queue is disabled on this deployment. Set EDISON_OCR_QUEUE_ENABLED=true on Vercel and redeploy.",
      },
      { status: 503 },
    );
  }

  if (!getOcrWorkerSecret()) {
    return NextResponse.json(
      {
        error:
          "OCR worker secret is not configured on this deployment. Set EDISON_OCR_WORKER_SECRET on Vercel and redeploy.",
      },
      { status: 503 },
    );
  }

  if (!isAuthorizedOcrWorker(request)) {
    return NextResponse.json(
      {
        error:
          "Unauthorized. EDISON_OCR_WORKER_SECRET on the worker must exactly match the value on Vercel.",
      },
      { status: 401 },
    );
  }

  const workerId =
    request.headers.get("x-edison-ocr-worker-id")?.trim() || "amarel-worker";
  const job = await claimNextOcrQueueJob(workerId);
  if (!job) {
    return NextResponse.json({ job: null });
  }
  return NextResponse.json({ job });
}
