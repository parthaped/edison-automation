# Edison OCR/HTR Workspace

This workspace keeps dataset harvesting, OCR/HTR training, evaluation, and local inference support outside the Next.js product code.

## Pipeline

1. Harvest Rutgers Edison Digital IIIF collections and manifests.
2. Normalize document/page inventories and extract transcript candidates from IIIF metadata when present.
3. **Build hybrid ground truth** from Scripto + vision-OCR (Gemini or local Kraken/TrOCR fallback).
4. Match harvested records to extracted or user-provided human transcripts (optional manual review).
5. Export line crops for Hugging Face recognizers.
6. Train and benchmark Kraken, TrOCR, GRM-OCR, and the current gateway baseline.
7. Serve or import local OCR output through the app's transcription result contract.

### Hybrid ground truth (validated Scripto + vision-OCR)

Edison Digital exposes **page-level Scripto transcriptions** through the Omeka API
(`scripto:transcription`, property id 186). Some Scripto records are **summaries**
(not diplomatic line-by-line text). The hybrid builder validates transcript type,
uses Scripto when diplomatic, and runs a **single vision-OCR pass** otherwise.

Vision-OCR provider (`label_provider.py`, `--label-provider auto`):

1. `google/gemini-2.5-flash` when `EDISON_GEMINI_API_KEY` is set
2. Fine-tuned Kraken phase-2 (local)
3. TrOCR (local)
4. Kraken `en_best` baseline (last resort)

```bash
# Requires ml/models/en_best.mlmodel (Kraken English baseline)
python ml/scripts/build_hybrid_ground_truth.py --limit 500 --device cuda:0 --label-provider auto
python ml/scripts/audit_gt_manifest.py --reclassify --vision-relabel --label-provider auto
```

Legacy Scripto-only builder (summary pages rejected): [`build_kraken_ground_truth.py`](scripts/build_kraken_ground_truth.py).

Outputs:

- `ml/data/pagexml/*.xml` — Kraken training ground truth
- `ml/data/manifests/kraken_gt_manifest.jsonl` — accepted pages
- `ml/data/manifests/kraken_gt_review.jsonl` — rejected pages with reasons
- `ml/data/raw/<document_id>/*.jpg` — downloaded page images

Then train:

```powershell
python ml/scripts/compile_kraken_dataset.py
.\ml\scripts\train_kraken.ps1 -BaseModel "ml\models\en_best.mlmodel"
python ml/scripts/export_lines_from_pagexml.py --pagexml-dir ml/data/pagexml --output ml/data/manifests/line_crops.jsonl --crop
python ml/scripts/evaluate_kraken_recognition.py
```

**Phase 3 fine-tune** (tier-A + tier-B, continues from phase-2 safetensors):

```powershell
python ml/scripts/export_kraken_checkpoint.py --model-dir ml/models/edison-htr-phase2.mlmodel
.\ml\scripts\train_phase3_kraken.ps1
```

**Quality curriculum** (recommended when phase-3 plateaus ~50% val accuracy):

The legacy 345-page corpus was built Scripto-only (no `label_source` / vision check).
This path upgrades labels, salvages rejected diplomatic pages with vision-OCR, and
trains on **line-confidence-filtered** PAGE XML (tier-A pages, `match_cer ≤ 0.28`).

```powershell
# Step-by-step
python ml/scripts/upgrade_gt_manifest.py --only-legacy --demote-low-quality --label-provider auto
python ml/scripts/refine_gt_with_vision.py --limit 150 --label-provider auto
python ml/scripts/build_confidence_pagexml.py --tier-a-only --label-provider auto
.\ml\scripts\train_quality_curriculum.ps1 -SkipUpgrade -SkipVisionSalvage -SkipConfidenceBuild

# Or run the full pipeline:
.\ml\scripts\train_quality_curriculum.ps1
```

Curation uses `label_source` confidence (`scripto_vision_agreed` > `scripto` > `vision_primary`).
Use `--include-tier-b` in [`prepare_phase2_training.py`](scripts/prepare_phase2_training.py) for more training pages.

**Gemini v5 fine-tune** (breaks circular `kraken_phase2` vision labels — required for real holdout gains):

838 of 920 training pages were labeled by Kraken phase-2 pretending to be vision-OCR.
Relabel with Gemini, then fine-tune from the most recent checkpoint:

```powershell
# Auth: EDISON_GEMINI_API_KEY in Vercel env / .env.local
python ml/scripts/test_gemini_auth.py

.\ml\scripts\train_gemini_v5.ps1
```

Pipeline: `relabel_gemini_training.py` (force Gemini on v4 train pages) → `prepare_gemini_v5.py` → ketos train → frozen 52-page benchmark.

Fallback without Gemini (scripto-only, ~30 pages): `.\ml\scripts\train_quality_v5.ps1`

### Reference OCR benchmark (Kraken vs Gemini/local)

```powershell
python ml/scripts/export_lines_from_pagexml.py --manifest ml/data/manifests/kraken_gt_manifest.jsonl --output ml/data/manifests/line_crops_eval.jsonl --crop
python ml/scripts/benchmark_vision_ocr.py --manifest ml/data/manifests/line_crops_eval.jsonl --split test
python ml/scripts/benchmark_models.py --manifest ml/data/manifests/line_crops_eval.jsonl --split test --models kraken --kraken-model ml/models/edison-htr-phase2.mlmodel
python ml/scripts/compare_to_reference.py
```

Target: Kraken character accuracy ≥ **80%** of the reference OCR on held-out `split=test` pages.

### Iterative train-until-target loop

Continuously expand Omeka ground truth, OCR-refine rejected pages, retrain, and
stop when held-out character accuracy reaches **70%** (or a plateau):

```powershell
python ml/scripts/iterative_kraken_train.py --target-accuracy 0.70 --max-iterations 8
```

Each iteration:

1. Harvest via `build_hybrid_ground_truth.py` (`--unprocessed-only`)
2. OCR-refine diplomatic Scripto rejections only (`refine_gt_with_ocr.py --require-transcript-type diplomatic`)
3. Curate tier-A + tier-B training pages + held-out test split
4. Fine-tune Kraken (`--resize union`), export safetensors, evaluate on test pages

State is tracked in `ml/data/manifests/iterative_train_state.json`.

If `ml/models/en_best.mlmodel` is missing, download a baseline with
`python ml/scripts/download_kraken_model.py`.

See [docs/data-contracts.md](docs/data-contracts.md) for manifest schemas.

### Local Kraken OCR (CUDA laptop + Cloudflare Tunnel)

See [docs/kraken-local-ocr.md](docs/kraken-local-ocr.md) for T1200 setup, `serve_kraken_ocr.py`, tunnel wiring, and Vercel env vars (`EDISON_LOCAL_OCR_URL`, `EDISON_LOCAL_OCR_SECRET`).

### Production ingest OCR (PaddleOCR-VL + Gemini format)

Ingest transcription is **not** Kraken or Gemini vision. Vercel rasterizes uploads, a pull worker runs **PaddleOCR-VL-1.6**, then Gemini applies Edison Markdown formatting and Omeka metadata from the OCR text only.

```powershell
# Laptop worker (see ml/docs/laptop-paddleocr-vl-worker.md)
.\ml\scripts\setup_paddleocr_vl.ps1
$env:EDISON_VERCEL_URL = "https://edison-papers-research.vercel.app"
$env:EDISON_OCR_WORKER_SECRET = "shared-secret"
.\ml\scripts\start_edison_worker.ps1
```

Offline smoke / benchmark:

```powershell
python ml/scripts/paddleocr_vl_pipeline.py --input path/to/file.pdf
python ml/scripts/compare_ocr_to_gemini.py --pdf path/to/file.pdf --predictions "paddleocr-vl-1.6=..."
```

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
