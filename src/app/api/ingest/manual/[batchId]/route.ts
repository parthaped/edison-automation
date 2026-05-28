import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getManualIngestJob } from "@/lib/edison/manual-ingest-jobs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  try {
    const { batchId } = await context.params;
    return NextResponse.json(getManualIngestJob(batchId));
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

