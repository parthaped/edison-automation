# Edison OCR/HTR Workspace

This workspace keeps dataset harvesting, OCR/HTR training, evaluation, and local inference support outside the Next.js product code.

## Pipeline

1. Harvest Rutgers Edison Digital IIIF collections and manifests.
2. Normalize document/page inventories and extract transcript candidates from IIIF metadata when present.
3. Match harvested records to extracted or user-provided human transcripts.
4. Align transcript text to page regions and lines by building PAGE XML/ALTO ground truth in eScriptorium.
5. Export line crops for Hugging Face recognizers.
6. Train and benchmark Kraken, TrOCR, GRM-OCR, and the current gateway baseline.
7. Serve or import local OCR output through the app's transcription result contract.

## First Run

Create a seed file with one folder ID per line:

```text
D9623-F
D9032-F
```

Harvest and normalize:

```bash
python ml/scripts/harvest_iiif.py --seed-file ml/configs/rutgers_seed_folders.txt --download-images
python ml/scripts/combine_transcripts.py --documents ml/data/manifests/documents.csv --transcripts ml/data/transcripts --output ml/data/manifests/source_manifest.csv
```

For an isolated one-document smoke test, skip the default seed file:

```bash
python ml/scripts/harvest_iiif.py --no-seed-file --seed LB003245 --documents-csv ml/data/manifests/smoke_documents.csv --pages-jsonl ml/data/manifests/smoke_pages.jsonl
```

Some IIIF manifests include document-level human transcript candidates in
metadata fields such as `Editor's Notes`, `Abstract`, `Description`,
`Transcript`, or `Transcription`. The harvester writes those candidates to
`ml/data/transcripts/<document_id>.txt` and marks the document row as
`transcript_status=available`.

Those transcript files are not yet HTR-ready labels. They still need to be
aligned to page regions and lines in PAGE XML/ALTO before training.

The generated manifests are intentionally ignored by git because they can grow quickly and may contain local paths.
