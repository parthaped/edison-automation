import { describe, expect, it } from "vitest";
import {
  extractDocumentIdFromIdentifier,
  getIiifManifestUrl,
  normalizeDocumentIdentifier,
} from "@/lib/omeka/client";

describe("getIiifManifestUrl", () => {
  it("builds IIIF 2 manifest URLs from document identifiers", () => {
    expect(getIiifManifestUrl("D0102AAB")).toBe(
      "https://edisondigital.rutgers.edu/iiif/2/D0102AAB/manifest",
    );
  });

  it("strips page suffixes from identifiers", () => {
    expect(extractDocumentIdFromIdentifier("D0102AAB_00027")).toBe("D0102AAB");
    expect(getIiifManifestUrl("D0102AAB_00027")).toBe(
      "https://edisondigital.rutgers.edu/iiif/2/D0102AAB/manifest",
    );
  });

  it("normalizes hyphenated identifiers", () => {
    expect(normalizeDocumentIdentifier("E2002-002")).toBe("E2002-002");
    expect(getIiifManifestUrl("E2002-002")).toBe(
      "https://edisondigital.rutgers.edu/iiif/2/E2002_002/manifest",
    );
  });

  it("returns null for empty identifiers", () => {
    expect(getIiifManifestUrl("")).toBeNull();
    expect(getIiifManifestUrl("   ")).toBeNull();
  });
});
