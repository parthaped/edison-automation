import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { z } from "zod";
import { toErrorResponse } from "@/lib/edison/app-error";
import {
  initialSnapshot,
  type IngestJobSnapshot,
} from "@/lib/edison/ingest-job-store";
import {
  batchIngestWorkflow,
  type BlobRef,
} from "@/lib/edison/workflows/batch-ingest";

export const runtime = "nodejs";
// The route only enqueues a workflow run; the actual work happens out-of-band
// inside the Workflow runtime, so the request can return immediately.
export const maxDuration = 30;

const blobRefSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  size: z.number().int().nonnegative(),
  contentType: z.string().min(1),
});

const jsonBodySchema = z.object({
  blobs: z.array(blobRefSchema).min(1),
  folderId: z.string().optional(),
  promptTask: z
    .enum(["diplomatic-transcription", "project-notebook"])
    .optional(),
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
      const folderId = sanitizeFolderId(parsed.data.folderId);
      const snapshot = await scheduleBatchIngest(
        parsed.data.blobs,
        folderId,
        parsed.data.promptTask,
      );
      return NextResponse.json(snapshot, { status: 202 });
    }

    const formData = await request.formData();
    const folderId = sanitizeFolderId(
      typeof formData.get("folderId") === "string"
        ? (formData.get("folderId") as string)
        : undefined,
    );
    const promptTask = parsePromptTask(formData.get("promptTask"));
    const blobs = await uploadFormDataFilesToBlob(formData);
    if (blobs.length === 0) {
      return NextResponse.json(
        { error: "Upload at least one file using the files field." },
        { status: 400 },
      );
    }
    const snapshot = await scheduleBatchIngest(blobs, folderId, promptTask);
    return NextResponse.json(snapshot, { status: 202 });
  } catch (error) {
    const response = toErrorResponse(error);
    return NextResponse.json(response.body, { status: response.status });
  }
}

async function scheduleBatchIngest(
  blobs: BlobRef[],
  folderId: string | undefined,
  promptTask: "diplomatic-transcription" | "project-notebook" | undefined,
): Promise<IngestJobSnapshot> {
  const run = await start(batchIngestWorkflow, [
    { folderId, blobs, promptTask },
  ]);
  return initialSnapshot(run.runId, {
    folderId,
    files: blobs.map((blob) => ({ name: blob.name, size: blob.size })),
  });
}

function parsePromptTask(
  value: FormDataEntryValue | null,
): "diplomatic-transcription" | "project-notebook" | undefined {
  if (value === "project-notebook" || value === "diplomatic-transcription") {
    return value;
  }
  return undefined;
}

async function uploadFormDataFilesToBlob(
  formData: FormData,
): Promise<BlobRef[]> {
  const blobs: BlobRef[] = [];
  for (const entry of formData.getAll("files")) {
    if (!isFile(entry)) continue;
    const uploaded = await put(`manual-ingest/${entry.name}`, entry, {
      access: "public",
      addRandomSuffix: true,
    });
    blobs.push({
      url: uploaded.url,
      name: entry.name,
      size: entry.size,
      contentType: entry.type || "application/octet-stream",
    });
  }
  return blobs;
}

function isFile(entry: FormDataEntryValue): entry is File {
  return (
    typeof entry === "object" &&
    entry !== null &&
    "arrayBuffer" in entry &&
    typeof entry.arrayBuffer === "function" &&
    "name" in entry &&
    typeof (entry as File).name === "string" &&
    "size" in entry &&
    typeof (entry as File).size === "number" &&
    "type" in entry &&
    typeof (entry as File).type === "string"
  );
}

function sanitizeFolderId(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
