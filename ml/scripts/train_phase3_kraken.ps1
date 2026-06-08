param(
  [string]$Manifest = "ml/data/manifests/kraken_gt_manifest.jsonl",
  [string]$InitModel = "ml/models/edison-htr-phase2.mlmodel/best_0.4943.safetensors",
  [string]$OutputModel = "ml/models/edison-htr-phase3.mlmodel",
  [string]$InitModel = "ml/models/edison-htr-phase2.mlmodel/checkpoint_48-0.4943.ckpt",
  [string]$TrainPageList = "ml/data/manifests/phase3_train_pagexml.txt",
  [int]$MaxEpochs = 35
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ketos -ErrorAction SilentlyContinue)) {
  throw "Kraken ketos CLI was not found."
}

$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) {
  throw "python was not found."
}

& $python.Source ml/scripts/export_kraken_checkpoint.py --model-dir "ml/models/edison-htr-phase2.mlmodel"
if (-not (Test-Path $InitModel)) {
  $fallback = "ml/models/en_best.mlmodel"
  if (Test-Path $fallback) {
    Write-Host "Phase-2 safetensors missing; falling back to $fallback"
    $InitModel = $fallback
  } else {
    throw "Init model not found: $InitModel"
  }
}

& $python.Source ml/scripts/prepare_phase2_training.py `
  --manifest $Manifest `
  --train-list $TrainPageList `
  --output "ml/data/manifests/phase3_curation.jsonl" `
  --include-tier-b
if ($LASTEXITCODE -ne 0) {
  throw "Phase-3 curation produced no training pages."
}

New-Item -ItemType Directory -Force -Path (Split-Path $CompiledData) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

& $python.Source ml/scripts/compile_kraken_dataset.py `
  --page-list $TrainPageList `
  --output $CompiledData `
  --num-workers 0

$env:PYTHONUTF8 = "1"
ketos --workers 0 train -f binary -i $InitModel -o $OutputModel --resize union $CompiledData -N $MaxEpochs

& $python.Source ml/scripts/export_kraken_checkpoint.py --model-dir $OutputModel

& $python.Source ml/scripts/export_lines_from_pagexml.py `
  --pagexml-dir ml/data/pagexml `
  --manifest $Manifest `
  --output ml/data/manifests/line_crops_phase3.jsonl `
  --crop

Write-Host "Phase-3 fine-tune complete."
