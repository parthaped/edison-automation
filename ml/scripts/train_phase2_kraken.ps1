param(
  [string]$Manifest = "ml/data/manifests/kraken_gt_manifest.jsonl",
  [string]$BaseModel = "ml/models/en_best.mlmodel",
  [string]$OutputModel = "ml/models/edison-htr-phase2.mlmodel",
  [string]$CompiledData = "ml/data/manifests/edison_recognition_phase2.arrow",
  [string]$TrainPageList = "ml/data/manifests/phase2_train_pagexml.txt",
  [int]$MaxEpochs = 30
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ketos -ErrorAction SilentlyContinue)) {
  throw "Kraken ketos CLI was not found."
}

$python = (Get-Command python -ErrorAction SilentlyContinue)
if (-not $python) {
  throw "python was not found."
}

& $python.Source ml/scripts/prepare_phase2_training.py --manifest $Manifest
if ($LASTEXITCODE -ne 0) {
  throw "Phase-2 curation produced no training pages."
}

New-Item -ItemType Directory -Force -Path (Split-Path $CompiledData) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

& $python.Source ml/scripts/compile_kraken_dataset.py `
  --page-list $TrainPageList `
  --output $CompiledData `
  --num-workers 0

if (-not (Test-Path $BaseModel)) {
  throw "Base model not found: $BaseModel"
}

$env:PYTHONUTF8 = "1"
ketos --workers 0 train -f binary -i $BaseModel -o $OutputModel --resize union $CompiledData -N $MaxEpochs

& $python.Source ml/scripts/export_lines_from_pagexml.py `
  --pagexml-dir ml/data/pagexml `
  --manifest $Manifest `
  --output ml/data/manifests/line_crops_phase2.jsonl `
  --crop

Write-Host "Phase-2 fine-tune complete. Evaluate with evaluate_kraken_recognition.py on the new checkpoint."
