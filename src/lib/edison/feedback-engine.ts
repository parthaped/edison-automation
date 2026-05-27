import type {
  AgentFeedback,
  ConfidenceCalibrationSuggestion,
  PromptRevisionCandidate,
  PromptVersion,
} from "./types";

const TAG_TO_INSTRUCTION: Record<string, string> = {
  hallucination: "Do not infer names, dates, places, or missing words beyond visible evidence.",
  "over-normalized": "Preserve original spelling and abbreviations unless explicitly asked to normalize.",
  "missed-uncertainty": "Mark uncertain words with [?] instead of presenting weak readings as certain.",
  "name-format": "Format people as last name first, followed by first and middle name or initials.",
  "table-format": "Keep lists, ledgers, and financial statements in table form when the source layout supports it.",
  "marginalia-format":
    "Place handwritten marginal notes in angle brackets with position in square brackets.",
};

export interface FeedbackSummary {
  total: number;
  byTag: Record<string, number>;
  highImpactFeedback: AgentFeedback[];
}

export function summarizeFeedback(feedback: AgentFeedback[]): FeedbackSummary {
  const byTag: Record<string, number> = {};
  for (const item of feedback) {
    for (const tag of item.issueTags) {
      byTag[tag] = (byTag[tag] ?? 0) + 1;
    }
  }

  return {
    total: feedback.length,
    byTag,
    highImpactFeedback: feedback.filter(
      (item) =>
        item.confidenceBefore === "high" &&
        ["low", "medium"].includes(item.confidenceAfter ?? ""),
    ),
  };
}

export function buildPromptRevisionCandidate(input: {
  task: PromptVersion["task"];
  basePromptVersion: string;
  basePrompt: string;
  feedback: AgentFeedback[];
  now?: string;
}): PromptRevisionCandidate {
  const summary = summarizeFeedback(input.feedback);
  const topTags = Object.entries(summary.byTag)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([tag]) => tag);
  const addedInstructions = topTags
    .map((tag) => TAG_TO_INSTRUCTION[tag])
    .filter(Boolean);

  const proposedPrompt =
    addedInstructions.length > 0
      ? `${input.basePrompt.trim()}\n\nReviewer feedback adjustments:\n${addedInstructions
          .map((instruction) => `- ${instruction}`)
          .join("\n")}`
      : input.basePrompt;

  return {
    id: `prompt-candidate-${input.task}-${Date.now()}`,
    task: input.task,
    basePromptVersion: input.basePromptVersion,
    proposedPrompt,
    rationale:
      topTags.length > 0
        ? `Generated from reviewer feedback tags: ${topTags.join(", ")}.`
        : "No recurring feedback tags were available; no prompt change recommended.",
    supportingFeedbackIds: input.feedback.map((item) => item.id),
    status: "draft",
    createdAt: input.now ?? new Date().toISOString(),
  };
}

export function suggestConfidenceCalibrations(
  feedback: AgentFeedback[],
  now = new Date().toISOString(),
): ConfidenceCalibrationSuggestion[] {
  return feedback
    .filter(
      (item) =>
        item.target === "confidence" ||
        (item.confidenceBefore === "high" &&
          ["medium", "low"].includes(item.confidenceAfter ?? "")),
    )
    .map((item) => ({
      id: `confidence-calibration-${item.id}`,
      reason:
        item.confidenceBefore === "high"
          ? "Reviewer corrected a high-confidence output; lower similar future outputs until prompt quality improves."
          : "Reviewer explicitly provided confidence feedback.",
      suggestedBucket: item.confidenceAfter ?? "medium",
      supportingFeedbackIds: [item.id],
      createdAt: now,
    }));
}

export function buildAgentImprovementScript(input: {
  candidate: PromptRevisionCandidate;
  calibrations: ConfidenceCalibrationSuggestion[];
}): string {
  const calibrationNotes =
    input.calibrations.length > 0
      ? input.calibrations
          .map((item) => `- ${item.reason} Suggested bucket: ${item.suggestedBucket}.`)
          .join("\n")
      : "- No confidence calibration changes recommended.";

  return `# Agent Improvement Draft

Task: ${input.candidate.task}
Base prompt version: ${input.candidate.basePromptVersion}
Status: ${input.candidate.status}

## Rationale
${input.candidate.rationale}

## Proposed Prompt
${input.candidate.proposedPrompt}

## Confidence Calibration Notes
${calibrationNotes}

## Promotion Checklist
- Evaluate this candidate against the fixed gold-standard benchmark set.
- Compare word error rate, uncertainty marking, metadata precision, and hallucination rate.
- Require human approval before marking this prompt active.`;
}
