#!/usr/bin/env node
/**
 * Build a serialized MiniSearch index from search-index JSONL.
 *
 * Usage:
 *   node scripts/build-minisearch-index.mjs [input.jsonl] [output.minisearch.json]
 */

import { createReadStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import MiniSearch from "minisearch";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_INPUT = join(__dirname, "../ml/data/search/search-index-v1.jsonl");
const DEFAULT_OUTPUT = join(__dirname, "../ml/data/search/search-index-v1.minisearch.json");

const MINI_SEARCH_OPTIONS = {
  fields: [
    "title",
    "description",
    "transcriptionText",
    "subjectsText",
    "creatorsText",
    "recipientsText",
    "namesMentionedText",
    "placesText",
    "identifier",
    "isPartOf",
    "documentType",
    "searchableText",
  ],
  storeFields: [
    "itemId",
    "identifier",
    "title",
    "description",
    "documentType",
    "date",
    "dateYear",
    "dateDecade",
    "creators",
    "recipients",
    "namesMentioned",
    "subjects",
    "places",
    "isPartOf",
    "transcriptionText",
    "transcriptionPreview",
    "searchableText",
    "thumbnailUrl",
    "edisonDigitalUrl",
  ],
  searchOptions: {
    boost: {
      title: 3,
      subjectsText: 2.5,
      description: 1.5,
      placesText: 1.5,
      transcriptionText: 1,
      creatorsText: 1,
      identifier: 2,
    },
    prefix: true,
    fuzzy: 0.15,
  },
};

function normalizeRecord(record) {
  return {
    ...record,
    id: String(record.itemId),
    subjectsText: Array.isArray(record.subjects) ? record.subjects.join(" ") : "",
    creatorsText: Array.isArray(record.creators) ? record.creators.join(" ") : "",
    recipientsText: Array.isArray(record.recipients) ? record.recipients.join(" ") : "",
    namesMentionedText: Array.isArray(record.namesMentioned) ? record.namesMentioned.join(" ") : "",
    placesText: Array.isArray(record.places) ? record.places.join(" ") : "",
  };
}

async function readJsonl(path) {
  const records = [];
  const stream = createReadStream(path, { encoding: "utf-8" });
  const reader = createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of reader) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    records.push(normalizeRecord(JSON.parse(trimmed)));
  }

  return records;
}

async function main() {
  const inputPath = resolve(process.argv[2] ?? DEFAULT_INPUT);
  const outputPath = resolve(process.argv[3] ?? DEFAULT_OUTPUT);

  if (!existsSync(inputPath)) {
    console.error(`Input JSONL not found: ${inputPath}`);
    console.error("Run: python ml/scripts/build_search_index.py");
    process.exit(1);
  }

  console.log(`Reading ${inputPath}...`);
  const records = await readJsonl(inputPath);
  console.log(`Building MiniSearch index for ${records.length} records...`);

  const miniSearch = new MiniSearch({
    ...MINI_SEARCH_OPTIONS,
    idField: "id",
  });
  miniSearch.addAll(records);

  const serialized = {
    options: MINI_SEARCH_OPTIONS,
    index: miniSearch.toJSON(),
  };

  writeFileSync(outputPath, JSON.stringify(serialized));
  console.log(`Wrote ${outputPath}`);

  const manifestPath = join(dirname(inputPath), "manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    manifest.miniSearchPath = outputPath.split(/[/\\]/).pop();
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Updated ${manifestPath}`);
  }
}

main().catch((error) => {
  console.error("MiniSearch build failed:", error);
  process.exit(1);
});
