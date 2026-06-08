param(
  [string]$InitCheckpoint = "ml/models/edison-htr-quality.mlmodel/checkpoint_04-0.9179.ckpt",
  [string]$OutputModel = "ml/models/edison-htr-finetune-v4.mlmodel",
  [string]$TrainArrow = "ml/data/manifests/edison_recognition_finetune_v4.arrow",
  [int]$MaxEpochs = 30,
  [switch]$SkipPrepare
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

$Python = Join-Path $RepoRoot "ml\.venv\Scripts\python.exe"
$Ketos = Join-Path $RepoRoot "ml\.venv\Scripts\ketos.exe"
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONUTF8 = "1"

Write-Host "=== V4 fine-tune plan ==="
Write-Host "  Init: $InitCheckpoint"
Write-Host "  Train: tier A+B pages (frozen 52-page test excluded)"
Write-Host "  Goal: improve real 52-page holdout (baseline ~55.7% line char acc)"

if (-not $SkipPrepare) {
  & $Python ml/scripts/prepare_finetune_v4.py
  if ($LASTEXITCODE -ne 0) { throw "Curation failed." }

  & $Python ml/scripts/compile_kraken_dataset.py `
    --page-list "ml/data/manifests/finetune_v4_train_pagexml.txt" `
    --output $TrainArrow `
    --num-workers 0
}

if (-not (Test-Path $InitCheckpoint)) {
  throw "Init checkpoint not found: $InitCheckpoint"
}

New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

Write-Host "=== Starting ketos train ($MaxEpochs epochs) ==="
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Ketos --workers 0 train -f binary -i $InitCheckpoint -o $OutputModel --resize union $TrainArrow -N $MaxEpochs *>&1 `
  | Tee-Object -FilePath "ml/reports/finetune_v4_train.log"
$trainExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($trainExit -ne 0) { throw "ketos train failed with exit $trainExit" }

& $Python ml/scripts/export_kraken_checkpoint.py --model-dir $OutputModel

Write-Host "=== Post-train eval on frozen 52-page holdout ==="
& $Python ml/scripts/export_lines_from_pagexml.py `
  --page-list "ml/data/manifests/frozen_test_52_pagexml.txt" `
  --manifest "ml/data/manifests/kraken_gt_manifest.pre_upgrade.jsonl" `
  --output "ml/data/manifests/line_crops_frozen52.jsonl" `
  --crop

$BestSafetensors = Get-ChildItem "$OutputModel/best_*.safetensors" -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if ($BestSafetensors) {
  & $Python ml/scripts/benchmark_models.py `
    --manifest "ml/data/manifests/line_crops_frozen52.jsonl" `
    --split all `
    --models kraken `
    --kraken-model $BestSafetensors.FullName `
    --kraken-mode recognition `
    --output "ml/reports/benchmark_finetune_v4_frozen52.jsonl"
}

Write-Host "Fine-tune v4 complete."
