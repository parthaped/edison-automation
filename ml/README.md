# Edison OCR/HTR Workspace

This workspace keeps dataset harvesting, OCR/HTR training, evaluation, and local inference support outside the Next.js product code.

## Pipeline

1. Harvest Rutgers Edison Digital IIIF collections and manifests.
2. Normalize document/page inventories.
3. Match harvested records to human transcripts.
4. Build PAGE XML/ALTO ground truth in eScriptorium.
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
python ml/scripts/harvest_iiif.py --seed-file ml/configs/rutgers_seed_folders.txt
python ml/scripts/combine_transcripts.py --documents ml/data/manifests/documents.csv --pages ml/data/manifests/pages.jsonl --transcripts ml/data/transcripts --output ml/data/manifests/source_manifest.csv
```

The generated manifests are intentionally ignored by git because they can grow quickly and may contain local paths.
