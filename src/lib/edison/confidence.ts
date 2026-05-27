import type { ConfidenceBucket } from "./types";

export interface ConfidenceInput {
  pageCount: number;
  extractionErrors: number;
  uncertainReadings: number;
  modelDisagreements: number;
  ocrTextLength: number;
}

export interface ConfidenceResult {
  bucket: ConfidenceBucket;
  score: number;
  reasons: string[];
}

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  const reasons: string[] = [];

  if (input.extractionErrors > 0 || input.pageCount === 0) {
    return {
      bucket: "blocked",
      score: 0,
      reasons: ["Extraction failed or produced no reviewable pages."],
    };
  }

  let score = 100;

  if (input.ocrTextLength < 80) {
    score -= 25;
    reasons.push("OCR text is very short for the extracted page count.");
  }

  if (input.uncertainReadings > 0) {
    const penalty = Math.min(30, input.uncertainReadings * 4);
    score -= penalty;
    reasons.push(`${input.uncertainReadings} uncertain readings need review.`);
  }

  if (input.modelDisagreements > 0) {
    const penalty = Math.min(25, input.modelDisagreements * 8);
    score -= penalty;
    reasons.push(`${input.modelDisagreements} model disagreements were detected.`);
  }

  if (input.pageCount > 20) {
    score -= 5;
    reasons.push("Large document packages receive extra review scrutiny.");
  }

  const bucket: ConfidenceBucket =
    score >= 85 ? "high" : score >= 55 ? "medium" : "low";

  return {
    bucket,
    score: Math.max(0, score),
    reasons: reasons.length > 0 ? reasons : ["Clean extraction and low uncertainty."],
  };
}
