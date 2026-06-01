import { describe, expect, it } from "vitest";
import { gradeTranscription } from "./confidence";
import { scoreConfidence } from "./service";

describe("scoreConfidence", () => {
  it("blocks packages with extraction errors", () => {
    expect(
      scoreConfidence({
        pageCount: 0,
        extractionErrors: 1,
        uncertainReadings: 0,
        wordCount: 0,
        ocrTextLength: 0,
      }).bucket,
    ).toBe("blocked");
  });

  it("routes clean packages to high confidence", () => {
    expect(
      scoreConfidence({
        pageCount: 2,
        extractionErrors: 0,
        uncertainReadings: 0,
        wordCount: 200,
        ocrTextLength: 1200,
      }).bucket,
    ).toBe("high");
  });

  it("keeps a long, mostly clean transcription at high confidence", () => {
    // 4 uncertain readings across 300 words is ~1.3% density: still high.
    expect(
      scoreConfidence({
        pageCount: 3,
        extractionErrors: 0,
        uncertainReadings: 4,
        wordCount: 300,
        ocrTextLength: 1800,
      }).bucket,
    ).toBe("high");
  });

  it("grades moderate uncertainty density as medium", () => {
    // 5 uncertain readings across 100 words is 5% density: medium.
    expect(
      scoreConfidence({
        pageCount: 1,
        extractionErrors: 0,
        uncertainReadings: 5,
        wordCount: 100,
        ocrTextLength: 600,
      }).bucket,
    ).toBe("medium");
  });

  it("routes high uncertainty density to low confidence", () => {
    expect(
      scoreConfidence({
        pageCount: 5,
        extractionErrors: 0,
        uncertainReadings: 12,
        wordCount: 50,
        ocrTextLength: 300,
      }).bucket,
    ).toBe("low");
  });

  it("grades transcriptions that are too short as low confidence", () => {
    expect(
      scoreConfidence({
        pageCount: 1,
        extractionErrors: 0,
        uncertainReadings: 0,
        wordCount: 6,
        ocrTextLength: 40,
      }).bucket,
    ).toBe("low");
  });
});

describe("gradeTranscription", () => {
  it("derives word count and grades a clean transcription as high", () => {
    const text = Array.from({ length: 120 }, () => "word").join(" ");
    expect(
      gradeTranscription({
        pageCount: 1,
        blocked: false,
        text,
        uncertainReadings: 0,
      }).bucket,
    ).toBe("high");
  });

  it("returns blocked for blocked packages", () => {
    expect(
      gradeTranscription({
        pageCount: 0,
        blocked: true,
        text: "",
        uncertainReadings: 0,
      }).bucket,
    ).toBe("blocked");
  });
});
