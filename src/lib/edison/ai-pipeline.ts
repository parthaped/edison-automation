import { scoreConfidence } from "./confidence";
import { getActivePrompt } from "./prompts";
import type {
  ConfidenceBucket,
  DocumentPackage,
  MetadataExtraction,
  TranscriptionRun,
} from "./types";

export interface AiPipelineInput {
  documentPackage: DocumentPackage;
  rawOcrText: string;
  model?: string;
}

export interface AiPipelineResult {
  transcriptionRun: TranscriptionRun;
  metadata: MetadataExtraction;
  confidence: ConfidenceBucket;
  confidenceReasons: string[];
}

function extractUncertainReadings(text: string): string[] {
  return text.match(/\[[^\]]+\?\]/g) ?? [];
}

function normalizeList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function runTranscriptionPipeline(
  input: AiPipelineInput,
): Promise<AiPipelineResult> {
  const diplomaticPrompt = getActivePrompt("diplomatic-transcription");
  const metadataPrompt = getActivePrompt("metadata-extraction");
  const cleanedText = input.rawOcrText.trim();
  const uncertainReadings = extractUncertainReadings(cleanedText);
  const confidenceResult = scoreConfidence({
    pageCount: input.documentPackage.pages.length,
    extractionErrors: input.documentPackage.status === "blocked" ? 1 : 0,
    uncertainReadings: uncertainReadings.length,
    modelDisagreements: 0,
    ocrTextLength: cleanedText.length,
  });

  const transcriptionRun: TranscriptionRun = {
    id: `${input.documentPackage.documentId}-run-1`,
    documentId: input.documentPackage.documentId,
    model: input.model ?? "gateway-configured-model",
    promptVersion: diplomaticPrompt.version,
    ocrText: input.rawOcrText,
    diplomaticText: cleanedText,
    uncertainReadings,
  };

  const metadata: MetadataExtraction = {
    folderId: input.documentPackage.folderId,
    documentId: input.documentPackage.documentId,
    documentType: "Unknown",
    date: "Unknown",
    authors: [],
    recipients: [],
    mentionedNames: [],
    subjects: normalizeList(["Needs review"]),
    imageNames: input.documentPackage.pages.map((page) => page.imageFilename),
    confidence: confidenceResult.bucket,
  };

  void metadataPrompt;

  return {
    transcriptionRun,
    metadata,
    confidence: confidenceResult.bucket,
    confidenceReasons: confidenceResult.reasons,
  };
}
