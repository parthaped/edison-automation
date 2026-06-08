param(
  [string]$InitCheckpoint = "",
  [string]$OutputModel = "ml/models/edison-htr-quality-v5.mlmodel",
  [string]$TrainArrow = "ml/data/manifests/edison_recognition_quality_v5.arrow",
  [int]$MaxEpochs = 25,
  [switch]$SkipPrepare
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

$Python = Join-Path $RepoRoot "ml\.venv\Scripts\python.exe"
$Ketos = Join-Path $RepoRoot "ml\.venv\Scripts\ketos.exe"
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONUTF8 = "1"

Get-Process ketos -ErrorAction SilentlyContinue | Stop-Process -Force

if (-not $InitCheckpoint) {
  $v4Latest = Get-ChildItem "ml/models/edison-htr-finetune-v4.mlmodel/checkpoint_*.ckpt" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.BaseName -replace '.*checkpoint_(\d+).*','$1') } -Descending |
    Select-Object -First 1
  $qualityBest = "ml/models/edison-htr-quality.mlmodel/checkpoint_04-0.9179.ckpt"
  if ($v4Latest -and (Test-Path $qualityBest) -and $v4Latest.LastWriteTime -gt (Get-Item $qualityBest).LastWriteTime) {
    $InitCheckpoint = $v4Latest.FullName.Replace("$RepoRoot\", "").Replace("\", "/")
  } else {
    $InitCheckpoint = $qualityBest
  }
}

Write-Host "=== Quality v5 training (no circular kraken_phase2 labels) ==="
Write-Host "  Init: $InitCheckpoint"
Write-Host "  Output: $OutputModel"

if (-not $SkipPrepare) {
  & $Python ml/scripts/prepare_quality_v5.py
  if ($LASTEXITCODE -ne 0) { throw "Quality v5 curation failed." }

  & $Python ml/scripts/compile_kraken_dataset.py `
    --page-list "ml/data/manifests/quality_v5_train_pagexml.txt" `
    --output $TrainArrow `
    --num-workers 0
}

if (-not (Test-Path $InitCheckpoint)) {
  throw "Init checkpoint not found: $InitCheckpoint"
}

New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Ketos --workers 0 train -f binary -i $InitCheckpoint -o $OutputModel --resize union $TrainArrow -N $MaxEpochs *>&1 `
  | Tee-Object -FilePath "ml/reports/quality_v5_train.log"
$trainExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($trainExit -ne 0) { throw "ketos train failed with exit $trainExit" }

& $Python ml/scripts/export_kraken_checkpoint.py --model-dir $OutputModel

& $Python ml/scripts/export_lines_from_pagexml.py `
  --page-list "ml/data/manifests/frozen_test_52_pagexml.txt" `
  --manifest "ml/data/manifests/kraken_gt_manifest.pre_upgrade.jsonl" `
  --output "ml/data/manifests/line_crops_frozen52.jsonl" `
  --crop

$BestSafetensors = Get-ChildItem "$OutputModel/best_*.safetensors" -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if ($BestSafetensors) {
  & $Python ml/scripts/benchmark_models.py `
    --manifest "ml/data/manifests/line_crops_frozen52.jsonl" `
    --split all `
    --models kraken `
    --kraken-model $BestSafetensors.FullName `
    --kraken-mode recognition `
    --output "ml/reports/benchmark_quality_v5_frozen52.jsonl"
}

Write-Host "Quality v5 training complete."
