import { NextResponse } from "next/server";
import { getRun } from "workflow/api";
import { AppError, toErrorResponse } from "@/lib/edison/app-error";
import {
  applyBatchEvent,
  emptySnapshot,
  type BatchEvent,
} from "@/lib/edison/ingest-job-store";

export const runtime = "nodejs";
export const maxDuration = 30;

// Maximum number of events we will pull from the durable stream per status
// poll. The stream length is bounded by O(files * stages + 2), so even a 100
// file batch only emits a few hundred events.
const MAX_EVENTS_PER_POLL = 4096;

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await context.params;
    const run = getRun<unknown>(batchId);

    if (!(await run.exists)) {
      throw new AppError(
        "NOT_FOUND",
        "Manual ingest batch was not found.",
        404,
      );
    }

    const events = await readBatchEvents(run);
    let snapshot = emptySnapshot(batchId);
    for (const event of events) {
      snapshot = applyBatchEvent(snapshot, event);
    }

    // If the workflow has completed/failed but we have not yet observed the
    // terminal event (race against stream propagation), reflect the workflow's
    // own lifecycle state so the client doesn't poll forever.
    const runStatus = await run.status;
    if (runStatus === "failed" && snapshot.status !== "failed") {
      snapshot = {
        ...snapshot,
        status: "failed",
        error: snapshot.error ?? "Workflow run failed.",
        updatedAt: new Date().toISOString(),
      };
    } else if (
      runStatus === "cancelled" &&
      snapshot.status !== "failed" &&
      snapshot.status !== "completed"
    ) {
      snapshot = {
        ...snapshot,
        status: "failed",
        error: "Workflow run was cancelled.",
        updatedAt: new Date().toISOString(),
      };
    } else if (
      (runStatus === "pending" || runStatus === "running") &&
      snapshot.status === "queued" &&
      events.length > 0
    ) {
      snapshot = { ...snapshot, status: "running" };
    }

    return NextResponse.json(snapshot);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

async function readBatchEvents(
  run: ReturnType<typeof getRun<unknown>>,
): Promise<BatchEvent[]> {
  const stream = run.getReadable<BatchEvent>({ startIndex: 0 });
  const tail = await stream.getTailIndex();
  if (tail < 0) {
    // No chunks yet. Cancel the unused reader to release resources.
    await stream.cancel().catch(() => undefined);
    return [];
  }

  const targetCount = Math.min(tail + 1, MAX_EVENTS_PER_POLL);
  const reader = stream.getReader();
  const events: BatchEvent[] = [];
  try {
    while (events.length < targetCount) {
      const result = await reader.read();
      const { done, value } = result;
      if (done) break;
      if (value !== undefined) events.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return events;
}
