import { describe, expect, it } from "vitest";
import type { OmekaItem } from "@/lib/omeka/types";
import { parseQueryIntent } from "./query-intent";
import {
  meetsTopicThreshold,
  MIN_RELEVANCE_SCORE,
  scoreDocumentRelevance,
} from "./scoring";

const motionPictureIntent = parseQueryIntent("Letters about making motion pictures");

const crotonMinesLetter: OmekaItem = {
  "o:id": 100,
  "o:title": "Letter from croton magnetic iron mines W H Hoffman to Thomas Alva Edison",
  "dcterms:title": [
    {
      "@value": "Letter from croton magnetic iron mines W H Hoffman to Thomas Alva Edison",
    },
  ],
  "dcterms:type": [{ "@value": "Letter" }],
  "dcterms:subject": [{ "@value": "Iron mines and mining" }],
  "scripto:transcription": [
    {
      "@value":
        "Dear Mr Edison, we are writing about ore shipments from the Croton magnetic iron mines.",
    },
  ],
};

const motionPictureLetter: OmekaItem = {
  "o:id": 101,
  "o:title": "Letter about kinetoscope demonstrations",
  "dcterms:title": [{ "@value": "Letter about kinetoscope demonstrations" }],
  "dcterms:type": [{ "@value": "Letter" }],
  "dcterms:subject": [{ "@value": "Motion pictures" }],
  "scripto:transcription": [
    {
      "@value":
        "We have been testing the kinetoscope and making motion pictures for upcoming exhibitions.",
    },
  ],
};

describe("scoreDocumentRelevance", () => {
  it("filters out unrelated letters that only match the document type", () => {
    expect(meetsTopicThreshold(crotonMinesLetter, motionPictureIntent)).toBe(false);

    const scored = scoreDocumentRelevance(
      crotonMinesLetter,
      motionPictureIntent.rawQuery,
      [],
      motionPictureIntent,
    );

    expect(scored.score).toBeLessThan(MIN_RELEVANCE_SCORE);
  });

  it("ranks motion-picture letters above unrelated correspondence", () => {
    expect(meetsTopicThreshold(motionPictureLetter, motionPictureIntent)).toBe(true);

    const crotonScore = scoreDocumentRelevance(
      crotonMinesLetter,
      motionPictureIntent.rawQuery,
      [],
      motionPictureIntent,
    ).score;
    const motionScore = scoreDocumentRelevance(
      motionPictureLetter,
      motionPictureIntent.rawQuery,
      [],
      motionPictureIntent,
    ).score;

    expect(motionScore).toBeGreaterThan(MIN_RELEVANCE_SCORE);
    expect(motionScore).toBeGreaterThan(crotonScore);
  });
});
