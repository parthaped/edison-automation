import { describe, expect, it } from "vitest";
import { getRasterizeBackend } from "./rasterize-provider";

describe("getRasterizeBackend", () => {
  it("defaults to pdfjs without pdftoppm configured", () => {
    expect(getRasterizeBackend({} as NodeJS.ProcessEnv)).toBe("pdfjs");
  });

  it("selects pdftoppm when EDISON_PDFTOPPM_PATH is set", () => {
    expect(
      getRasterizeBackend({
        EDISON_PDFTOPPM_PATH: "/usr/bin/pdftoppm",
      } as unknown as NodeJS.ProcessEnv),
    ).toBe("pdftoppm");
  });
});
