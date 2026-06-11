import { describe, expect, it } from "vitest";
import { parseIiifManifest } from "./manifest";

describe("parseIiifManifest", () => {
  it("extracts page images from IIIF Presentation 2 manifests", () => {
    const pages = parseIiifManifest({
      sequences: [
        {
          canvases: [
            {
              label: "1",
              width: 1360,
              height: 1680,
              images: [
                {
                  resource: {
                    "@id": "https://edisondigital.rutgers.edu/files/original/D0102AAB/00027.jpg",
                    width: 1360,
                    height: 1680,
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(pages).toHaveLength(1);
    expect(pages[0]?.url).toContain("D0102AAB/00027.jpg");
    expect(pages[0]?.width).toBe(1360);
  });
});
