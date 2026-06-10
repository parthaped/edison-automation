import { describe, expect, it } from "vitest";
import { getIiifManifestUrl, normalizeDocumentIdentifier } from "@/lib/omeka/client";

describe("getIiifManifestUrl", () => {
  it("builds manifest URLs from document identifiers", () => {
    expect(getIiifManifestUrl("D0102AAB_00027")).toBe(
      "https://edisondigital.rutgers.edu/iiif/D0102AAB_00027/manifest",
    );
  });

  it("normalizes hyphenated identifiers", () => {
    expect(normalizeDocumentIdentifier("E2002-002")).toBe("E2002-002");
    expect(getIiifManifestUrl("E2002-002")).toBe(
      "https://edisondigital.rutgers.edu/iiif/E2002_002/manifest",
    );
  });

  it("returns null for empty identifiers", () => {
    expect(getIiifManifestUrl("")).toBeNull();
    expect(getIiifManifestUrl("   ")).toBeNull();
  });
});
