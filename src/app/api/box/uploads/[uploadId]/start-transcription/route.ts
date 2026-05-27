import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ uploadId: string }> },
) {
  try {
    const { uploadId } = await params;
    const result = await getEdisonService().startTranscriptionForBoxUpload(uploadId);
    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
