import { NextResponse } from "next/server";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((entry): entry is File => entry instanceof File);
    const rawFolderId = formData.get("folderId");
    const folderId =
      typeof rawFolderId === "string" && rawFolderId.trim() !== ""
        ? rawFolderId
        : undefined;

    const packages = await getEdisonService().ingestManualFiles({
      files,
      folderId,
    });

    return NextResponse.json({ packages }, { status: 202 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
