# Edison Gold Set Workflow

The first gold set should be small, representative, and carefully aligned. Target 50 pages:

- 30 correspondence pages.
- 10 notebook/list pages.
- 10 hard pages with marginalia, low contrast, unusual layout, or mixed print/handwriting.

## Selection

Use `ml/data/manifests/source_manifest.csv` to choose documents with available human transcripts. The first source can be the transcript candidates extracted from IIIF metadata into `ml/data/transcripts/<document_id>.txt`; replace or correct them with better human transcripts when you have them. Prefer diversity over volume:

- Multiple folders.
- Multiple document types.
- Multiple known writers if available.
- Both clean and difficult scans.

## eScriptorium Setup

1. Import page images from `ml/data/raw/<document_id>/`.
2. Create text regions for body, header, footer, signature, marginal notes, and tables.
3. Add line baselines in reading order.
4. Open the matching transcript candidate from `ml/data/transcripts/<document_id>.txt`.
5. Paste or type the exact human transcription line by line, correcting the IIIF candidate where needed.
6. Flag uncertain or excluded lines in the transcription notes, not in the recognizer label.
7. Export PAGE XML with image references.

## Review Checklist

- Every training line has a visible baseline or polygon.
- Reading order matches the intended transcription order.
- Marginalia and signatures are region-labeled.
- Uncertain lines are excluded or flagged.
- The PAGE XML image filename resolves to a local image.
- Train/validation/test split is inherited by document, not line.

## Automated alternative (Scripto-aligned)

When eScriptorium review is not yet available, the repo can build Kraken-compatible
PAGE XML from Rutgers Scripto transcriptions:

```bash
python ml/scripts/build_kraken_ground_truth.py --limit 500 --unprocessed-only --resume --device cuda:0
```

Select a diverse 50-page gold subset for the first training/eval cycle:

```bash
python ml/scripts/select_gold_set.py
python ml/scripts/verify_gold_set.py
```

Outputs:

- `ml/data/manifests/gold_set_manifest.jsonl`
- `ml/data/manifests/gold_set_pagexml.txt`

Replace Scripto-aligned pages with eScriptorium-reviewed exports over time; keep
document-level splits intact.

## Outputs

Place reviewed PAGE XML files in:

```text
ml/data/pagexml/
```

Then generate line-crop JSONL:

```bash
python ml/scripts/export_lines_from_pagexml.py \
  --manifest ml/data/manifests/kraken_gt_manifest.jsonl \
  --output ml/data/manifests/line_crops.jsonl \
  --crop
```
