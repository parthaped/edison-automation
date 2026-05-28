import { NextResponse } from "next/server";
import { AppError, toErrorResponse } from "@/lib/edison/app-error";
import { getIngestJobStore } from "@/lib/edison/ingest-job-store";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await context.params;
    const snapshot = await getIngestJobStore().read(batchId);
    if (!snapshot) {
      throw new AppError(
        "NOT_FOUND",
        "Manual ingest batch was not found.",
        404,
      );
    }
    return NextResponse.json(snapshot);
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
