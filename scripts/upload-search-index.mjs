#!/usr/bin/env node
/**
 * Upload search index artifacts to Vercel Blob.
 *
 * Requires BLOB_READ_WRITE_TOKEN. Run after build_search_index.py and
 * build-minisearch-index.mjs:
 *
 *   npm run search:build
 */

import { createReadStream, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { put } from "@vercel/blob";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEARCH_DIR = join(__dirname, "../ml/data/search");
const INDEX_VERSION = "v1";

const ARTIFACTS = [
  {
    localName: `search-index-${INDEX_VERSION}.jsonl`,
    blobPath: `search/index-${INDEX_VERSION}.jsonl`,
    contentType: "application/x-ndjson",
  },
  {
    localName: `search-index-${INDEX_VERSION}.minisearch.json`,
    blobPath: `search/index-${INDEX_VERSION}.minisearch.json`,
    contentType: "application/json",
  },
  {
    localName: "manifest.json",
    blobPath: "search/manifest.json",
    contentType: "application/json",
  },
];

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error(
    "BLOB_READ_WRITE_TOKEN is not set. Run `vercel env pull .env.local` and re-run with `node --env-file=.env.local scripts/upload-search-index.mjs`.",
  );
  process.exit(1);
}

async function uploadFile(localPath, blobPath, contentType) {
  const body =
    contentType === "application/x-ndjson"
      ? createReadStream(localPath)
      : readFileSync(localPath);

  const result = await put(blobPath, body, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true,
  });

  console.log(`Uploaded ${blobPath} → ${result.url}`);
  return result.url;
}

async function main() {
  for (const artifact of ARTIFACTS) {
    const localPath = join(SEARCH_DIR, artifact.localName);
    if (!existsSync(localPath)) {
      console.error(`Missing artifact: ${localPath}`);
      console.error("Run: npm run search:build (without upload) first.");
      process.exit(1);
    }
    await uploadFile(localPath, artifact.blobPath, artifact.contentType);
  }

  console.log("Search index upload complete.");
}

main().catch((error) => {
  console.error("Upload failed:", error);
  process.exit(1);
});
