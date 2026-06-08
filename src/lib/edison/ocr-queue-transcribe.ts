import { sleepMs } from "./ai-request";
import {
  getOcrQueuePollMs,
  getOcrQueueTimeoutMs,
} from "./ocr-queue-config";
import {
  createOcrQueueJob,
  getOcrQueueJob,
  type OcrQueueJob,
} from "./ocr-queue-store";
import type { TranscribePageChunkResult } from "./page-chunk-transcribe";

function mapOcrQueueJobToChunkResult(
  job: OcrQueueJob,
): TranscribePageChunkResult {
  return {
    pages: job.pages
      .map((page) => ({
        pageNumber: page.pageNumber,
        text: (page.text ?? "").trim(),
      }))
      .sort((left, right) => left.pageNumber - right.pageNumber),
    model: job.model ?? "local/qwen2.5-vl-7b-instruct",
    promptVersion: job.promptVersion ?? "local-qwen-vl-v1",
  };
}

export async function createAndWaitForOcrQueueJob(input: {
  fileName?: string;
  pages: Array<{ pageNumber: number; imageUrl: string }>;
  signal?: AbortSignal;
}): Promise<TranscribePageChunkResult> {
  const job = await createOcrQueueJob({
    fileName: input.fileName,
    pages: input.pages,
  });

  const deadline = Date.now() + getOcrQueueTimeoutMs();
  const pollMs = getOcrQueuePollMs();

  while (Date.now() < deadline) {
    if (input.signal?.aborted) {
      throw new Error("OCR queue wait aborted.");
    }

    const current = await getOcrQueueJob(job.jobId);
    if (!current) {
      throw new Error(`OCR queue job disappeared: ${job.jobId}`);
    }
    if (current.status === "complete") {
      return mapOcrQueueJobToChunkResult(current);
    }
    if (current.status === "failed") {
      throw new Error(current.error ?? `OCR queue job failed: ${job.jobId}`);
    }

    await sleepMs(pollMs);
  }

  throw new Error(
    `Timed out waiting for Amarel OCR worker (${job.jobId}) after ${getOcrQueueTimeoutMs()}ms.`,
  );
}
