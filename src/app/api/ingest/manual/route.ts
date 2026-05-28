import { del } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { getEdisonService } from "@/lib/edison/service-factory";
import type { UploadFileLike } from "@/lib/edison/service";

export const runtime = "nodejs";
export const maxDuration = 60;

const blobRefSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  contentType: z.string().min(1),
});

const jsonBodySchema = z.object({
  blobs: z.array(blobRefSchema).min(1),
  folderId: z.string().optional(),
});

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";

    let files: UploadFileLike[];
    let folderId: string | undefined;
    let blobUrlsToDelete: string[] = [];

    if (contentType.includes("application/json")) {
      const parsed = jsonBodySchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid ingest payload.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      folderId =
        parsed.data.folderId && parsed.data.folderId.trim() !== ""
          ? parsed.data.folderId
          : undefined;

      files = await Promise.all(
        parsed.data.blobs.map(async (blob) => {
          const response = await fetch(blob.url);
          if (!response.ok) {
            throw new Error(
              `Failed to fetch blob ${blob.name} from ${blob.url}: ${response.status}`,
            );
          }
          const arrayBuffer = await response.arrayBuffer();
          return {
            name: blob.name,
            size: blob.size || arrayBuffer.byteLength,
            type: blob.contentType,
            arrayBuffer: async () => arrayBuffer,
          } satisfies UploadFileLike;
        }),
      );
      blobUrlsToDelete = parsed.data.blobs.map((blob) => blob.url);
    } else {
      const formData = await request.formData();
      files = formData
        .getAll("files")
        .filter((entry): entry is File => entry instanceof File);
      const rawFolderId = formData.get("folderId");
      folderId =
        typeof rawFolderId === "string" && rawFolderId.trim() !== ""
          ? rawFolderId
          : undefined;
    }

    const result = await getEdisonService().ingestManualFiles({
      files,
      folderId,
    });

    // Clean up temporary blob uploads. The OCR text + metadata are durably
    // stored in the response; the original bytes are no longer needed.
    if (blobUrlsToDelete.length > 0) {
      await Promise.allSettled(blobUrlsToDelete.map((url) => del(url)));
    }

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}
