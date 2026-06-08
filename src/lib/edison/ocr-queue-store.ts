import { list, put } from "@vercel/blob";
import { z } from "zod";

const OCR_QUEUE_PREFIX = "ocr-queue/";

const ocrQueuePageSchema = z.object({
  pageNumber: z.number().int().positive(),
  imageUrl: z.string().url(),
  text: z.string().optional(),
});

const ocrQueueJobSchema = z.object({
  jobId: z.string().uuid(),
  status: z.enum(["pending", "claimed", "complete", "failed"]),
  createdAt: z.string(),
  claimedAt: z.string().optional(),
  completedAt: z.string().optional(),
  workerId: z.string().optional(),
  fileName: z.string().optional(),
  pages: z.array(ocrQueuePageSchema).min(1),
  model: z.string().optional(),
  promptVersion: z.string().optional(),
  error: z.string().optional(),
});

export type OcrQueueJob = z.infer<typeof ocrQueueJobSchema>;

function jobPath(jobId: string): string {
  return `${OCR_QUEUE_PREFIX}${jobId}.json`;
}

async function putOcrQueueJob(job: OcrQueueJob): Promise<void> {
  await put(jobPath(job.jobId), JSON.stringify(job), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
}

export async function getOcrQueueJob(jobId: string): Promise<OcrQueueJob | null> {
  const blobs = await list({ prefix: jobPath(jobId), limit: 1 });
  const blob = blobs.blobs.find((entry) => entry.pathname === jobPath(jobId));
  if (!blob) {
    return null;
  }
  const response = await fetch(blob.url, { cache: "no-store" });
  if (!response.ok) {
    return null;
  }
  return ocrQueueJobSchema.parse(await response.json());
}

async function listOcrQueueJobs(): Promise<OcrQueueJob[]> {
  const jobs: OcrQueueJob[] = [];
  let cursor: string | undefined;
  do {
    const result = await list({ prefix: OCR_QUEUE_PREFIX, limit: 1000, cursor });
    for (const blob of result.blobs) {
      if (!blob.pathname.endsWith(".json")) {
        continue;
      }
      const response = await fetch(blob.url, { cache: "no-store" });
      if (!response.ok) {
        continue;
      }
      try {
        jobs.push(ocrQueueJobSchema.parse(await response.json()));
      } catch {
        // Ignore corrupt queue entries.
      }
    }
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return jobs;
}

export async function createOcrQueueJob(input: {
  fileName?: string;
  pages: Array<{ pageNumber: number; imageUrl: string }>;
}): Promise<OcrQueueJob> {
  const job: OcrQueueJob = {
    jobId: crypto.randomUUID(),
    status: "pending",
    createdAt: new Date().toISOString(),
    fileName: input.fileName,
    pages: input.pages.map((page) => ({
      pageNumber: page.pageNumber,
      imageUrl: page.imageUrl,
    })),
  };
  await putOcrQueueJob(job);
  return job;
}

export async function claimNextOcrQueueJob(workerId: string): Promise<OcrQueueJob | null> {
  const jobs = await listOcrQueueJobs();
  const pending = jobs
    .filter((job) => job.status === "pending")
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt),
    );
  const next = pending[0];
  if (!next) {
    return null;
  }

  const claimed: OcrQueueJob = {
    ...next,
    status: "claimed",
    workerId,
    claimedAt: new Date().toISOString(),
  };
  await putOcrQueueJob(claimed);
  return claimed;
}

export async function completeOcrQueueJob(input: {
  jobId: string;
  pages: Array<{ pageNumber: number; text: string }>;
  model: string;
  promptVersion: string;
}): Promise<OcrQueueJob> {
  const existing = await getOcrQueueJob(input.jobId);
  if (!existing) {
    throw new Error(`OCR queue job not found: ${input.jobId}`);
  }
  const textByPage = new Map(
    input.pages.map((page) => [page.pageNumber, page.text.trim()]),
  );
  const completed: OcrQueueJob = {
    ...existing,
    status: "complete",
    completedAt: new Date().toISOString(),
    model: input.model,
    promptVersion: input.promptVersion,
    pages: existing.pages.map((page) => ({
      ...page,
      text: textByPage.get(page.pageNumber) ?? page.text ?? "",
    })),
  };
  await putOcrQueueJob(completed);
  return completed;
}

export async function failOcrQueueJob(
  jobId: string,
  error: string,
): Promise<OcrQueueJob> {
  const existing = await getOcrQueueJob(jobId);
  if (!existing) {
    throw new Error(`OCR queue job not found: ${jobId}`);
  }
  const failed: OcrQueueJob = {
    ...existing,
    status: "failed",
    completedAt: new Date().toISOString(),
    error,
  };
  await putOcrQueueJob(failed);
  return failed;
}
