import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { rasterizePdfPages } from "./rasterize-pdf";

// End-to-end smoke test that exercises the pdfjs-dist render API against the
// @napi-rs/canvas backend. Catches regressions in either:
//   - the render({ canvas, viewport }) call shape (pdfjs 5.x changed it once
//     already), and
//   - the canvas.encode("jpeg", quality) output format.
// We build the PDF in-memory with pdf-lib so the test has no fixture file to
// maintain and runs cross-platform without network access.

async function buildTwoPagePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let pageNumber = 1; pageNumber <= 2; pageNumber += 1) {
    const page = pdf.addPage([300, 400]);
    page.drawText(`Page ${pageNumber}`, {
      x: 50,
      y: 350,
      size: 24,
      font,
      color: rgb(0, 0, 0),
    });
  }
  return pdf.save();
}

describe("rasterizePdfPages", () => {
  it(
    "renders every PDF page as a real JPEG with non-zero dimensions",
    { timeout: 60_000 },
    async () => {
      const bytes = await buildTwoPagePdf();
      const rendered = await rasterizePdfPages(bytes);

      expect(rendered).toHaveLength(2);
      rendered.forEach((page, index) => {
        expect(page.pageIndex).toBe(index);
        expect(page.width).toBeGreaterThan(0);
        expect(page.height).toBeGreaterThan(0);
        // JPEG magic bytes: 0xFF 0xD8 (SOI). Asserting this guarantees the
        // canvas encoder produced an actual JPEG rather than an empty buffer.
        expect(page.jpg.length).toBeGreaterThan(8);
        expect(page.jpg[0]).toBe(0xff);
        expect(page.jpg[1]).toBe(0xd8);
      });
    },
  );

  it("respects a custom scale parameter", { timeout: 60_000 }, async () => {
    const bytes = await buildTwoPagePdf();
    const small = await rasterizePdfPages(bytes, { scale: 1 });
    const large = await rasterizePdfPages(bytes, { scale: 2 });
    expect(large[0].width).toBeGreaterThan(small[0].width);
    expect(large[0].height).toBeGreaterThan(small[0].height);
  });
});
