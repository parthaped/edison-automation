#!/usr/bin/env node
/**
 * One-off screenshot script for the Beamer presentation.
 *
 * Captures https://edison.rutgers.edu/ at 1440x900 and writes the result to
 * docs/presentation/images/edison-rutgers-home.png. Run with:
 *
 *   npx playwright install chromium
 *   node scripts/capture-edison-home.mjs
 */

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(here, "..", "docs", "presentation", "images", "edison-rutgers-home.png");

await mkdir(dirname(outPath), { recursive: true });

const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  await page.goto("https://edison.rutgers.edu/", { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`Wrote ${outPath}`);
} finally {
  await browser.close();
}
