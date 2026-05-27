import type { PromptVersion } from "./types";

export const PROMPT_LIBRARY: PromptVersion[] = [
  {
    id: "ocr-cleanup-v1",
    task: "ocr-cleanup",
    version: "1.0.0",
    active: true,
    prompt: `You are assisting with archival text correction for the Thomas Edison Papers.
Correct obvious OCR errors only when strongly supported by context.
Preserve original wording, spelling, punctuation, abbreviations, and line structure.
Do not modernize language. Do not guess missing text.
If uncertain, keep the original word and mark it with [?].`,
  },
  {
    id: "diplomatic-transcription-v1",
    task: "diplomatic-transcription",
    version: "1.0.0",
    active: true,
    prompt: `Produce a diplomatic transcription of a 19th century Thomas Edison document.
Preserve original spelling, abbreviations, punctuation, grammar, and visible line order.
Mark unclear or illegible words with [?].
If a word is partially readable, include your best reading followed by [?].
Do not invent missing content.`,
  },
  {
    id: "metadata-extraction-v1",
    task: "metadata-extraction",
    version: "1.0.0",
    active: true,
    prompt: `Extract only metadata explicitly supported by the transcription.
Return document type, date in Year-Month-Day format when available, authors, recipients,
mentioned names, short-form subjects, confidence, and image names.
Use last name first for people. If unknown, write "Unknown".`,
  },
];

export function getActivePrompt(task: PromptVersion["task"]): PromptVersion {
  const prompt = PROMPT_LIBRARY.find((candidate) => candidate.task === task && candidate.active);
  if (!prompt) {
    throw new Error(`No active prompt found for task: ${task}`);
  }

  return prompt;
}
