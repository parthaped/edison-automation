import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsImages = resolve(__dirname, "..", "docs", "images");
await mkdir(docsImages, { recursive: true });

const svgPath = resolve(docsImages, "architecture.svg");
const pngPath = resolve(docsImages, "architecture.png");

const svg = await readFile(svgPath, "utf8");

const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html, body { margin: 0; padding: 0; background: #0b1220; }
      #wrap { width: 1600px; }
      svg { display: block; width: 1600px; height: auto; }
    </style>
  </head>
  <body>
    <div id="wrap">${svg}</div>
  </body>
</html>`;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1600, height: 1180 },
  deviceScaleFactor: 2,
  reducedMotion: "reduce",
});
const page = await context.newPage();
await page.setContent(html, { waitUntil: "load" });

const wrap = await page.$("#wrap");
if (!wrap) throw new Error("wrap element missing");
const buf = await wrap.screenshot({ type: "png", omitBackground: false });
await writeFile(pngPath, buf);
console.log(`Wrote ${pngPath} (${buf.length} bytes)`);

await browser.close();
