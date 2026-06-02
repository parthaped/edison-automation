import type { PromptVersion } from "./types";

// Canonical instruction blocks as authored by the project lead. Versions are
// bumped here when the wording changes so transcription runs can record which
// prompt produced the output.
export const PROMPT_LIBRARY: PromptVersion[] = [
  {
    id: "diplomatic-transcription-v2",
    task: "diplomatic-transcription",
    version: "2.0.0",
    active: false,
    prompt: `These are the image files for Doc ID [provide ID]. It is in Folder ID [provide ID]. It is a [type of document]. Transcribe the text with the following format order: Letterhead, dateline, salutation, body of the text, closing text, signature, any annotations to the document. Use formatting from the original: paragraphing (without line breaks), punctuation, and underlining. If less than 70% confident of a word or phrase, put it in brackets with a question mark at the end. Put any annotations or marginal notes at the end. Handwritten marginal notes should be italicized and put in angle brackets <> with position indicated in square brackets []. Any lists or financial statements should be formatted as a table. Use each image name as a heading before its text.`,
  },
  {
    id: "diplomatic-transcription-v3",
    task: "diplomatic-transcription",
    version: "3.0.0",
    active: true,
    prompt: `These are the image files for Doc ID [provide ID]. It is in Folder ID [provide ID]. It is a [type of document]. Transcribe using Edison Markdown v1:

Output rules:
- Start each page with a Markdown heading: ## {exact image filename}
- Use these exact section labels on their own line, followed by the section text on following lines (blank line between sections): Letterhead:, Dateline:, To:, From:, Salutation:, Body:, Closing:, Signature:, Annotations:
- Include To: and From: only when visible on the source. Omit unused sections.
- Preserve original spelling, abbreviations, punctuation, and underlining. Use paragraph breaks between sections, not mid-sentence line breaks.
- If less than 70% confident of a word or phrase, bracket it with a trailing question mark, e.g. [filament?]
- Handwritten marginal notes go under Annotations:, italicized in angle brackets <> with position in square brackets [], e.g. <note text> [right margin]
- Lists, ledgers, and financial statements MUST use GitHub-flavored Markdown pipe tables with a header row and | --- | separator row. Never use tab-separated columns or plain prose for tabular data.
- Do not pad with spaces for visual alignment; layout is applied in the review UI.`,
  },
  {
    id: "metadata-extraction-v3",
    task: "metadata-extraction",
    version: "3.0.0",
    active: true,
    prompt: `Index this document for the TAEP Omeka-S catalog used on edisondigital.rutgers.edu. Produce: a concise descriptive Title naming the principal correspondents or topic (do not repeat the Doc ID or Folder ID); the Document Type from the TAEP list (Letter, Memorandum, Telegram, Report, and similar); the Date in ISO form Year-Month-Day (use Year-Month or Year when only partial, or leave empty); the Author(s) and Recipient(s) formatted last name first with first and middle name or initials; Name(s) Mentioned for other people and organizations; Places for geographic locations; one topical Subject; and Comments for marginalia or attachment notes. Base every field strictly on the document and leave it empty rather than guessing. Separate multiple entries within a field with a semicolon.`,
  },
  {
    id: "project-notebook-v1",
    task: "project-notebook",
    version: "1.0.0",
    active: true,
    prompt: `This image contains numbered laboratory projects with information about where it should be charged [chg.] and about when the project was opened and closed. The date at the far right is the date the project began. Transcribe the list so that the number of the project is in column one, the project description is in column two, the charging information is in column 3, the date the project was begun in column 4, and the date the project closed is in column 5.`,
  },
];

export function getActivePrompt(task: PromptVersion["task"]): PromptVersion {
  const prompt = PROMPT_LIBRARY.find(
    (candidate) => candidate.task === task && candidate.active,
  );
  if (!prompt) {
    throw new Error(`No active prompt found for task: ${task}`);
  }
  return prompt;
}

export type TranscriptionPromptTask =
  | "diplomatic-transcription"
  | "project-notebook";
