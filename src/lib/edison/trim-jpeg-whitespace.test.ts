import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";
import { trimJpegWhitespace } from "./trim-jpeg-whitespace";

describe("trimJpegWhitespace", () => {
  it("removes wide white margins while preserving content bounds", async () => {
    const canvas = createCanvas(400, 300);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = "#111111";
    ctx.fillRect(20, 40, 120, 180);

    const source = new Uint8Array(await canvas.encode("jpeg", 85));
    const trimmed = await trimJpegWhitespace(source);

    expect(trimmed.trimmed).toBe(true);
    expect(trimmed.width).toBeLessThan(400);
    expect(trimmed.height).toBeLessThan(300);
    expect(trimmed.width).toBeGreaterThan(100);
    expect(trimmed.height).toBeGreaterThan(150);
  });

  it("returns the original JPEG when the page is entirely white", async () => {
    const canvas = createCanvas(120, 80);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 120, 80);

    const source = new Uint8Array(await canvas.encode("jpeg", 85));
    const trimmed = await trimJpegWhitespace(source);

    expect(trimmed.trimmed).toBe(false);
    expect(trimmed.width).toBe(120);
    expect(trimmed.height).toBe(80);
    expect(trimmed.jpg).toEqual(source);
  });
});
