param(
  [string]$Manifest = "ml/data/manifests/kraken_gt_manifest.jsonl",
  [string]$EvalManifest = "ml/data/manifests/line_crops_eval.jsonl",
  [string]$KrakenModel = "ml/models/edison-htr-phase2.mlmodel",
  [string]$LabelProvider = "auto"
)

$ErrorActionPreference = "Stop"
$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) { throw "python not found" }

& $python.Source ml/scripts/audit_gt_manifest.py --manifest $Manifest --reclassify
& $python.Source ml/scripts/export_lines_from_pagexml.py `
  --manifest $Manifest `
  --output $EvalManifest `
  --crop
& $python.Source ml/scripts/benchmark_vision_ocr.py `
  --manifest $EvalManifest `
  --split test `
  --label-provider $LabelProvider
& $python.Source ml/scripts/benchmark_models.py `
  --manifest $EvalManifest `
  --split test `
  --models kraken `
  --kraken-model $KrakenModel
& $python.Source ml/scripts/compare_to_reference.py

Write-Host "Eval baseline complete. See ml/reports/reference_comparison.csv"
