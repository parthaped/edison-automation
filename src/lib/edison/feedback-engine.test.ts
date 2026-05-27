import { describe, expect, it } from "vitest";
import {
  buildAgentImprovementScript,
  buildPromptRevisionCandidate,
  suggestConfidenceCalibrations,
  summarizeFeedback,
} from "./feedback-engine";
import type { AgentFeedback } from "./types";

const feedback: AgentFeedback[] = [
  {
    id: "feedback-1",
    documentId: "D9032-00001",
    reviewer: "Archivist",
    target: "transcription",
    promptVersion: "1.0.0",
    model: "gateway-configured-model",
    originalValue: "filament",
    correctedValue: "[filament?]",
    issueTags: ["missed-uncertainty"],
    confidenceBefore: "high",
    confidenceAfter: "medium",
    createdAt: "2026-05-27T12:00:00.000Z",
  },
  {
    id: "feedback-2",
    documentId: "D9032-00002",
    reviewer: "Archivist",
    target: "metadata",
    originalValue: "Thomas Edison",
    correctedValue: "Edison, Thomas Alva",
    issueTags: ["name-format"],
    createdAt: "2026-05-27T12:01:00.000Z",
  },
];

describe("feedback engine", () => {
  it("summarizes recurring issue tags", () => {
    const summary = summarizeFeedback(feedback);

    expect(summary.total).toBe(2);
    expect(summary.byTag["missed-uncertainty"]).toBe(1);
    expect(summary.highImpactFeedback).toHaveLength(1);
  });

  it("builds a prompt revision candidate from reviewer feedback", () => {
    const candidate = buildPromptRevisionCandidate({
      task: "diplomatic-transcription",
      basePromptVersion: "1.0.0",
      basePrompt: "Transcribe the document.",
      feedback,
      now: "2026-05-27T12:02:00.000Z",
    });

    expect(candidate.status).toBe("draft");
    expect(candidate.proposedPrompt).toContain("Reviewer feedback adjustments");
    expect(candidate.proposedPrompt).toContain("Mark uncertain words");
  });

  it("suggests confidence calibration when high-confidence output is corrected", () => {
    const suggestions = suggestConfidenceCalibrations(feedback);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].suggestedBucket).toBe("medium");
  });

  it("builds an auditable agent improvement script", () => {
    const candidate = buildPromptRevisionCandidate({
      task: "diplomatic-transcription",
      basePromptVersion: "1.0.0",
      basePrompt: "Transcribe the document.",
      feedback,
    });

    const script = buildAgentImprovementScript({
      candidate,
      calibrations: suggestConfidenceCalibrations(feedback),
    });

    expect(script).toContain("Promotion Checklist");
    expect(script).toContain("Require human approval");
  });
});
