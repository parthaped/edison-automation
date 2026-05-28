import { NextResponse } from "next/server";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import { createManualIngestJob } from "@/lib/edison/manual-ingest-jobs";
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

    if (contentType.includes("application/json")) {
      const parsed = jsonBodySchema.safeParse(await request.json());
      if (!parsed.success) {
        return NextResponse.json(
          { error: "Invalid ingest payload.", issues: parsed.error.issues },
          { status: 400 },
        );
      }
      const folderId =
        parsed.data.folderId && parsed.data.folderId.trim() !== ""
          ? parsed.data.folderId
          : undefined;

      const job = createManualIngestJob({
        kind: "blob",
        blobs: parsed.data.blobs,
        folderId,
      });
      return NextResponse.json(job, { status: 202 });
    }

    const formData = await request.formData();
    const files: UploadFileLike[] = formData
      .getAll("files")
      .flatMap((entry) => {
        const file = toUploadFileLike(entry);
        return file ? [file] : [];
      });
    const rawFolderId = formData.get("folderId");
    const folderId =
      typeof rawFolderId === "string" && rawFolderId.trim() !== ""
        ? rawFolderId
        : undefined;

    const job = createManualIngestJob({
      kind: "files",
      files,
      folderId,
    });
    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

function toUploadFileLike(entry: FormDataEntryValue): UploadFileLike | null {
  if (
    typeof entry === "object" &&
    entry !== null &&
    "arrayBuffer" in entry &&
    typeof entry.arrayBuffer === "function" &&
    "name" in entry &&
    typeof entry.name === "string" &&
    "size" in entry &&
    typeof entry.size === "number" &&
    "type" in entry &&
    typeof entry.type === "string"
  ) {
    return {
      name: entry.name,
      size: entry.size,
      type: entry.type,
      arrayBuffer: () => entry.arrayBuffer(),
    };
  }
  return null;
}
