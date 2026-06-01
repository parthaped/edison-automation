# Edison Gold Set Workflow

The first gold set should be small, representative, and carefully aligned. Target 50 pages:

- 30 correspondence pages.
- 10 notebook/list pages.
- 10 hard pages with marginalia, low contrast, unusual layout, or mixed print/handwriting.

## Selection

Use `ml/data/manifests/source_manifest.csv` to choose documents with available human transcripts. Prefer diversity over volume:

- Multiple folders.
- Multiple document types.
- Multiple known writers if available.
- Both clean and difficult scans.

## eScriptorium Setup

1. Import page images from `ml/data/raw/<document_id>/`.
2. Create text regions for body, header, footer, signature, marginal notes, and tables.
3. Add line baselines in reading order.
4. Paste or type the exact human transcription line by line.
5. Flag uncertain or excluded lines in the transcription notes, not in the recognizer label.
6. Export PAGE XML with image references.

## Review Checklist

- Every training line has a visible baseline or polygon.
- Reading order matches the intended transcription order.
- Marginalia and signatures are region-labeled.
- Uncertain lines are excluded or flagged.
- The PAGE XML image filename resolves to a local image.
- Train/validation/test split is inherited by document, not line.

## Outputs

Place reviewed PAGE XML files in:

```text
ml/data/pagexml/
```

Then generate line-crop JSONL:

```bash
python ml/scripts/export_lines_from_pagexml.py --pagexml-dir ml/data/pagexml --output ml/data/manifests/line_crops.jsonl --crop
```
