#!/usr/bin/env node
/**
 * Empties every blob in the project's Vercel Blob store. Use this to reset the
 * workbench so the next upload starts fresh. Deletes records/*.json,
 * page-images/<documentId>/*.jpg, manual-ingest/* and the top-level source
 * uploads written by the client-direct upload path.
 *
 * Requires BLOB_READ_WRITE_TOKEN. Pull it locally with `vercel env pull
 * .env.local` and run:
 *
 *   node --env-file=.env.local scripts/wipe-blob-store.mjs
 *
 * or, after sourcing the env into your shell:
 *
 *   npm run wipe:blob
 *
 * The store is paginated by `list({ limit: 1000, cursor })`; URLs are deleted
 * in batches of 100 (the `del` API limit).
 */

import { del, list } from "@vercel/blob";

const PAGE_SIZE = 1000;
const DELETE_BATCH = 100;

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error(
    "BLOB_READ_WRITE_TOKEN is not set. Run `vercel env pull .env.local` and re-run with `node --env-file=.env.local scripts/wipe-blob-store.mjs`.",
  );
  process.exit(1);
}

async function collectAllBlobs() {
  const collected = [];
  let cursor;
  do {
    const result = await list({ limit: PAGE_SIZE, cursor });
    collected.push(...result.blobs);
    cursor = result.hasMore ? result.cursor : undefined;
  } while (cursor);
  return collected;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function main() {
  console.log("Listing every blob in the store...");
  const blobs = await collectAllBlobs();
  if (blobs.length === 0) {
    console.log("Store is already empty. Nothing to delete.");
    return;
  }

  console.log(`Found ${blobs.length} blob(s). Deleting in batches of ${DELETE_BATCH}...`);
  const urls = blobs.map((blob) => blob.url);
  const batches = chunk(urls, DELETE_BATCH);
  let deleted = 0;
  for (const [index, batch] of batches.entries()) {
    await del(batch);
    deleted += batch.length;
    console.log(`  batch ${index + 1}/${batches.length}: deleted ${batch.length} (running total ${deleted}/${urls.length})`);
  }

  console.log(`Done. Removed ${deleted} blob(s) from the store.`);
}

main().catch((error) => {
  console.error("Wipe failed:", error);
  process.exit(1);
});
