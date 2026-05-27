import { describe, expect, it } from "vitest";
import { scoreConfidence } from "./confidence";

describe("scoreConfidence", () => {
  it("blocks packages with extraction errors", () => {
    expect(
      scoreConfidence({
        pageCount: 0,
        extractionErrors: 1,
        uncertainReadings: 0,
        modelDisagreements: 0,
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
        modelDisagreements: 0,
        ocrTextLength: 500,
      }).bucket,
    ).toBe("high");
  });

  it("routes high uncertainty to low confidence", () => {
    expect(
      scoreConfidence({
        pageCount: 5,
        extractionErrors: 0,
        uncertainReadings: 12,
        modelDisagreements: 2,
        ocrTextLength: 300,
      }).bucket,
    ).toBe("low");
  });
});
