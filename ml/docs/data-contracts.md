# Edison OCR/HTR Data Contracts

These contracts keep the Rutgers harvester, human transcript alignment, model training, evaluation, and product integration compatible.

## Document Inventory CSV

One row per Edison document.

```csv
document_id,folder_id,title,date,document_type,authors,mentioned_names,subjects,page_count,rights,license,iiif_manifest_url,source_url,archive_url,local_image_dir,transcript_status,transcript_source,transcript_path,split,notes
```

Required fields are `document_id`, `folder_id`, `title`, `page_count`, `iiif_manifest_url`, and `source_url`.

When transcript-like text is present in the IIIF metadata, the harvester writes
it to `ml/data/transcripts/<document_id>.txt` and sets:

- `transcript_status`: `available`
- `transcript_source`: metadata source such as `iiif:Editor's Notes`
- `transcript_path`: local path to the extracted transcript candidate

If no transcript candidate is present, `transcript_status` is `missing` and the
source/path fields are blank.

## Page Inventory JSONL

One JSON object per source page.

```json
{"document_id":"NS7501A","page_index":0,"source_page":"1","image_url":"https://edisondigital.rutgers.edu/files/original/NS7501A/ag0312.jpg","width":708,"height":1108,"local_path":"ml/data/raw/NS7501A/page_0001.jpg"}
```

## Source Manifest CSV

One row per document after transcript matching and corpus classification.

```csv
document_id,folder_id,source_path,source_mime,page_count,transcript_path,transcript_granularity,document_type,text_mode,layout_type,writer_group,split,quality_notes,exclude_from_training
```

IIIF `Abstract` / `Description` / `Editor's Notes` transcript candidates set
`exclude_from_training=yes`. They are document-level summaries, not page diplomatic labels.

## Kraken GT Manifest JSONL

One JSON object per accepted Scripto-aligned or hybrid-labeled page.

```json
{"id":"D9211AFP_fb0685","status":"accepted","label_source":"scripto_vision_agreed","transcript_type":"diplomatic","vision_provider":"gemini","match_ratio":0.86,"validated_lines":6,"pagexml_path":"ml/data/pagexml/D9211AFP_fb0685.xml","split":"train"}
```

`label_source` values: `scripto`, `scripto_vision_agreed`, `vision_primary`, `ocr_assisted`.

`transcript_type` values: `diplomatic`, `summary`, `ambiguous`.

Use `transcript_granularity` values `missing`, `document`, `page`, `line`, or `region`.

Extracted IIIF transcript candidates are usually document-level. They are useful
for selecting and aligning documents, but they are not line-level recognizer
labels until PAGE XML/ALTO regions and `TextLine` entries have been created.

## Line-Crop JSONL

One row per cropped text line for Hugging Face recognizers.

```json
{"id":"D9032-00001_p0001_l0007","document_id":"D9032-00001","page_index":0,"line_index":7,"image_path":"ml/data/lines/D9032-00001/p0001_l0007.png","text":"Mr. Edison returned the drawings yesterday","region_type":"body","writer_group":"unknown","split":"train","quality_flags":[]}
```

Required fields are `id`, `image_path`, `text`, and `split`.

## Evaluation JSONL

One row per prediction.

```json
{"id":"D9032-00001_p0001_l0007","model":"microsoft/trocr-base-handwritten-edison-v1","reference":"Mr. Edison returned the drawings yesterday","prediction":"Mr. Edison returned the drawing yesterday","cer":0.025,"wer":0.143,"split":"test"}
```

## Local Inference Response

Local OCR services should return this shape. The app can flatten `pages[*].text` into `ocrText` while preserving line detail for review UI.

```json
{
  "ocrText": "Full document transcription...",
  "model": "local/trocr-base-edison-v1",
  "promptVersion": "local-htr-v1",
  "uncertainReadings": [],
  "pages": [
    {
      "pageIndex": 0,
      "text": "Page transcription...",
      "lines": [
        {
          "lineIndex": 0,
          "bbox": [120, 240, 980, 286],
          "text": "Mr. Edison returned the drawings yesterday",
          "confidence": 0.91
        }
      ]
    }
  ]
}
```

## Kraken Ground-Truth Manifest JSONL

One row per page processed by `build_kraken_ground_truth.py`.

Accepted pages (`ml/data/manifests/kraken_gt_manifest.jsonl`):

```json
{
  "id": "CL207AAA_00777",
  "document_id": "CL207AAA",
  "media_id": 434830,
  "document_type": "Letter",
  "image_path": "ml/data/raw/CL207AAA/00777.jpg",
  "pagexml_path": "ml/data/pagexml/CL207AAA_00777.xml",
  "scripto_lines": 12,
  "training_lines": 10,
  "segmented_lines": 14,
  "matched_lines": 11,
  "validated_lines": 10,
  "match_ratio": 0.79,
  "mean_match_cer": 0.22,
  "median_match_cer": 0.18,
  "split": "train",
  "quality_flags": [],
  "status": "accepted"
}
```

Rejected pages (`ml/data/manifests/kraken_gt_review.jsonl`) use the same fields plus
`reason` (for example `match_ratio_below_threshold` or `median_cer_above_threshold`).

Required fields for accepted rows: `id`, `document_id`, `pagexml_path`, `status`.
