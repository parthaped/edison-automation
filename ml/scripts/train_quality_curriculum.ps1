param(
  [string]$Manifest = "ml/data/manifests/kraken_gt_manifest.jsonl",
  [string]$InitModel = "ml/models/edison-htr-phase3.mlmodel/checkpoint_10-0.4980.ckpt",
  [string]$OutputModel = "ml/models/edison-htr-quality.mlmodel",
  [string]$CompiledData = "ml/data/manifests/edison_recognition_quality.arrow",
  [string]$TrainPageList = "ml/data/manifests/confidence_train_pagexml.txt",
  [int]$MaxEpochs = 40,
  [switch]$SkipUpgrade,
  [switch]$SkipVisionSalvage,
  [switch]$SkipConfidenceBuild
)

$ErrorActionPreference = "Stop"

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$VenvPython = Join-Path $RepoRoot "ml\.venv\Scripts\python.exe"
$VenvKetos = Join-Path $RepoRoot "ml\.venv\Scripts\ketos.exe"
if (-not (Test-Path $VenvPython)) {
  $python = Get-Command python -ErrorAction SilentlyContinue
  if (-not $python) {
    throw "python was not found (ml/.venv missing)."
  }
  $VenvPython = $python.Source
}
if (-not (Test-Path $VenvKetos)) {
  $ketos = Get-Command ketos -ErrorAction SilentlyContinue
  if (-not $ketos) {
    throw "ketos was not found (ml/.venv missing)."
  }
  $VenvKetos = $ketos.Source
}

Set-Location $RepoRoot
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONUTF8 = "1"


if (-not $SkipUpgrade) {
  Write-Host "=== Upgrade legacy manifest with hybrid vision ==="
  & $VenvPython ml/scripts/upgrade_gt_manifest.py `
    --manifest $Manifest `
    --only-legacy `
    --demote-low-quality `
    --resume `
    --skip-forced-align `
    --label-provider auto
}

if (-not $SkipVisionSalvage) {
  Write-Host "=== Vision salvage rejected diplomatic pages ==="
  & $VenvPython ml/scripts/refine_gt_with_vision.py `
    --manifest $Manifest `
    --limit 150 `
    --label-provider auto
}

if (-not $SkipConfidenceBuild) {
  Write-Host "=== Build line-confidence PAGE XML (tier-A gate) ==="
  & $VenvPython ml/scripts/build_confidence_pagexml.py `
    --manifest $Manifest `
    --tier-a-only `
    --label-provider auto
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Confidence build empty; falling back to tier-A PAGE XML list."
    & $VenvPython ml/scripts/prepare_phase2_training.py `
      --manifest $Manifest `
      --train-list $TrainPageList `
      --output "ml/data/manifests/quality_tier_a_curation.jsonl"
    if ($LASTEXITCODE -ne 0) {
      throw "No tier-A training pages available for quality curriculum."
    }
  }
}

if (-not (Test-Path $InitModel)) {
  $phase3Ckpt = Get-ChildItem "ml/models/edison-htr-phase3.mlmodel/checkpoint_*.ckpt" -ErrorAction SilentlyContinue |
    Sort-Object { if ($_.Name -match '-(\d+\.\d+)\.ckpt$') { [double]$Matches[1] } else { 0 } } -Descending |
    Select-Object -First 1
  if ($phase3Ckpt) {
    $InitModel = $phase3Ckpt.FullName
  } else {
    & $VenvPython ml/scripts/export_kraken_checkpoint.py --model-dir "ml/models/edison-htr-phase2.mlmodel"
    $InitModel = "ml/models/edison-htr-phase2.mlmodel/checkpoint_48-0.4943.ckpt"
  }
}

New-Item -ItemType Directory -Force -Path (Split-Path $CompiledData) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

Write-Host "=== Compile confidence-filtered Arrow dataset ==="
& $VenvPython ml/scripts/compile_kraken_dataset.py `
  --page-list $TrainPageList `
  --output $CompiledData `
  --num-workers 0

Write-Host "=== Train quality curriculum model (tier-A confident lines only) ==="
$env:PYTHONUTF8 = "1"
& $VenvKetos --workers 0 train -f binary -i $InitModel -o $OutputModel --resize union $CompiledData -N $MaxEpochs

& $VenvPython ml/scripts/export_kraken_checkpoint.py --model-dir $OutputModel

Write-Host "Quality curriculum training complete."
