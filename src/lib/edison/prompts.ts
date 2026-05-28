import type { PromptVersion } from "./types";

// Canonical instruction blocks as authored by the project lead. Versions are
// bumped here when the wording changes so transcription runs can record which
// prompt produced the output.
export const PROMPT_LIBRARY: PromptVersion[] = [
  {
    id: "diplomatic-transcription-v2",
    task: "diplomatic-transcription",
    version: "2.0.0",
    active: true,
    prompt: `These are the image files for Doc ID [provide ID]. It is in Folder ID [provide ID]. It is a [type of document]. Transcribe the text with the following format order: Letterhead, dateline, salutation, body of the text, closing text, signature, any annotations to the document. Use formatting from the original: paragraphing (without line breaks), punctuation, and underlining. If less than 70% confident of a word or phrase, put it in brackets with a question mark at the end. Put any annotations or marginal notes at the end. Handwritten marginal notes should be italicized and put in angle brackets <> with position indicated in square brackets []. Any lists or financial statements should be formatted as a table. Use each image name as a heading before its text.`,
  },
  {
    id: "metadata-extraction-v2",
    task: "metadata-extraction",
    version: "2.0.0",
    active: true,
    prompt: `Extract and list the following metadata from this document. Document type, Date in the format Year-Month-Day, Author(s), Recipient(s), Name Mentions that are not author(s) or recipient(s), primary general Subjects in short form; Image name(s). Put each element in a separate column. The first column will contain the Folder ID the second column will contain the Doc ID. The last column should include the image name(s). All names should be formatted with last name first, first and middle name or initials. If there are multiple entries in a column separate each with a semicolon.`,
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
