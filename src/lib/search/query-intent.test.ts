import { describe, expect, it } from "vitest";
import { parseQueryIntent, hasCompoundTopicIntent } from "./query-intent";

describe("parseQueryIntent", () => {
  it("parses letters-about compound queries", () => {
    const intent = parseQueryIntent("Letters about making motion pictures");

    expect(intent.documentTypeHint).toBe("Letter");
    expect(intent.topicQuery).toBe("making motion pictures");
    expect(intent.topicTerms).toEqual(
      expect.arrayContaining(["making", "motion", "pictures", "motion pictures"]),
    );
    expect(hasCompoundTopicIntent(intent)).toBe(true);
  });

  it("parses letter on phonograph queries", () => {
    const intent = parseQueryIntent("letter on phonograph");

    expect(intent.documentTypeHint).toBe("Letter");
    expect(intent.topicQuery).toBe("phonograph");
    expect(intent.topicTerms).toEqual(expect.arrayContaining(["phonograph", "gramophone"]));
  });

  it("leaves simple queries unchanged", () => {
    const intent = parseQueryIntent("electric light");

    expect(intent.documentTypeHint).toBeUndefined();
    expect(intent.topicQuery).toBe("electric light");
    expect(hasCompoundTopicIntent(intent)).toBe(false);
  });
});
