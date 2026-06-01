import type { ConfidenceBucket } from "./types";

export interface ConfidenceInput {
  pageCount: number;
  extractionErrors: number;
  // Count of unique uncertain readings (bracketed `[word?]` markers).
  uncertainReadings: number;
  // Number of words in the transcription. Used to express uncertainty as a
  // density rather than an absolute count so a long, otherwise clean document
  // with a few flagged readings still grades "high".
  wordCount: number;
  ocrTextLength: number;
}

export interface ConfidenceResult {
  bucket: ConfidenceBucket;
  score: number;
  reasons: string[];
}

// Density cutoffs (uncertain readings per word):
//   <= 2%  -> high   (display score >= 85)
//   <= 6%  -> medium (display score 55-84)
//   >  6%  -> low    (display score < 55)
// Grading on density instead of raw bracket counts stops clean long
// transcriptions from defaulting to "medium" just because they contain a
// handful of flagged words.
const HIGH_MAX_DENSITY = 0.02;
const MEDIUM_MAX_DENSITY = 0.06;
const DENSITY_SCORE_FACTOR = 750;
const MIN_GRADABLE_LENGTH = 80;

export function scoreConfidence(input: ConfidenceInput): ConfidenceResult {
  if (input.extractionErrors > 0 || input.pageCount === 0) {
    return {
      bucket: "blocked",
      score: 0,
      reasons: ["Extraction failed or produced no reviewable pages."],
    };
  }

  if (input.ocrTextLength < MIN_GRADABLE_LENGTH) {
    return {
      bucket: "low",
      score: 40,
      reasons: ["Transcription is too short to grade with confidence."],
    };
  }

  const wordCount = Math.max(input.wordCount, 1);
  const density = input.uncertainReadings / wordCount;
  const uncertaintyPct = Math.round(density * 1000) / 10;
  const score = Math.max(
    0,
    Math.min(100, Math.round(100 - density * DENSITY_SCORE_FACTOR)),
  );

  const bucket: ConfidenceBucket =
    density <= HIGH_MAX_DENSITY
      ? "high"
      : density <= MEDIUM_MAX_DENSITY
        ? "medium"
        : "low";

  const reasons =
    input.uncertainReadings === 0
      ? ["No uncertain readings flagged."]
      : [
          `${input.uncertainReadings} uncertain reading${
            input.uncertainReadings === 1 ? "" : "s"
          } across ${wordCount} words (${uncertaintyPct}% uncertain).`,
        ];

  return { bucket, score, reasons };
}

export function extractUncertainReadings(text: string): string[] {
  return [...new Set(text.match(/\[[^\]]+\?\]/g) ?? [])];
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

// Grades a transcription from its text and page state. Used both at ingest and
// when a reviewer edits the transcription, so the stored confidence always
// reflects the current text.
export function gradeTranscription(params: {
  pageCount: number;
  blocked: boolean;
  text: string;
  uncertainReadings: number;
}): ConfidenceResult {
  const trimmed = params.text.trim();
  return scoreConfidence({
    pageCount: params.pageCount,
    extractionErrors: params.blocked ? 1 : 0,
    uncertainReadings: params.uncertainReadings,
    wordCount: countWords(trimmed),
    ocrTextLength: trimmed.length,
  });
}
