param(
  [string]$GatewayApiKey = "",
  [string]$InitCheckpoint = "",
  [string]$OutputModel = "ml/models/edison-htr-v5.mlmodel",
  [string]$TrainArrow = "ml/data/manifests/edison_recognition_v5.arrow",
  [int]$MaxEpochs = 25,
  [switch]$SkipRelabel,
  [switch]$SkipPrepare
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

$Python = Join-Path $RepoRoot "ml\.venv\Scripts\python.exe"
$Ketos = Join-Path $RepoRoot "ml\.venv\Scripts\ketos.exe"
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
chcp 65001 | Out-Null
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Read-DotEnvValue([string]$Path, [string]$Name) {
  if (-not (Test-Path $Path)) { return "" }
  foreach ($line in Get-Content $Path) {
    if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.+?)\s*$") {
      return $matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return ""
}

$envLocal = Join-Path $RepoRoot ".env.local"
if (-not $GatewayApiKey) {
  $GatewayApiKey = Read-DotEnvValue $envLocal "EDISON_AI_GATEWAY_KEY"
}
if (-not $GatewayApiKey) { $GatewayApiKey = $env:EDISON_AI_GATEWAY_KEY }
if ($GatewayApiKey) {
  $env:EDISON_AI_GATEWAY_KEY = $GatewayApiKey
  $env:AI_GATEWAY_API_KEY = $GatewayApiKey
}

Get-Process ketos -ErrorAction SilentlyContinue | Stop-Process -Force

if (-not $InitCheckpoint) {
  $qualityBest = "ml/models/edison-htr-quality.mlmodel/checkpoint_04-0.9179.ckpt"
  $v4Latest = Get-ChildItem "ml/models/edison-htr-finetune-v4.mlmodel/checkpoint_*.ckpt" -ErrorAction SilentlyContinue |
    Sort-Object { [int]($_.BaseName -replace '.*checkpoint_(\d+).*','$1') } -Descending |
    Select-Object -First 1
  if ($v4Latest -and (Test-Path $qualityBest) -and $v4Latest.LastWriteTime -gt (Get-Item $qualityBest).LastWriteTime) {
    $InitCheckpoint = $v4Latest.FullName.Replace("$RepoRoot\", "").Replace("\", "/")
  } else {
    $InitCheckpoint = $qualityBest
  }
}

Write-Host "=== Edison HTR v5 training ==="
Write-Host "  Init: $InitCheckpoint"
Write-Host "  Output: $OutputModel"

$useGemini = $false
if (-not $SkipRelabel) {
  & $Python ml/scripts/test_gateway_auth.py 2>$null
  if ($LASTEXITCODE -eq 0) {
    $useGemini = $true
    Write-Host "=== Gemini relabel (gateway auth OK) ==="
    & $Python ml/scripts/relabel_gemini_training.py `
      --page-list "ml/data/manifests/finetune_v4_train_pagexml.txt" `
      --resume `
      --demote-low-quality `
      --skip-forced-align
    if ($LASTEXITCODE -ne 0) { throw "Gemini relabel failed." }
  } else {
    Write-Host "=== Gemini unavailable; Scripto-only relabel (no circular kraken_phase2 labels) ==="
    & $Python ml/scripts/relabel_scripto_training.py `
      --page-list "ml/data/manifests/finetune_v4_train_pagexml.txt" `
      --resume `
      --skip-forced-align
    if ($LASTEXITCODE -ne 0) { throw "Scripto relabel failed." }
  }
}

if (-not $SkipPrepare) {
  if ($useGemini) {
    & $Python ml/scripts/prepare_gemini_v5.py
    $trainList = "ml/data/manifests/gemini_v5_train_pagexml.txt"
  } else {
    & $Python ml/scripts/prepare_v5_combined.py
    $trainList = "ml/data/manifests/v5_train_pagexml.txt"
  }
  if ($LASTEXITCODE -ne 0) { throw "v5 curation failed." }
  & $Python ml/scripts/compile_kraken_dataset.py `
    --page-list $trainList `
    --output $TrainArrow `
    --num-workers 0
}

if (-not (Test-Path $InitCheckpoint)) {
  throw "Init checkpoint not found: $InitCheckpoint"
}

New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$trainLog = "ml/reports/v5_train.log"
& $Ketos --workers 0 train -f binary -i $InitCheckpoint -o $OutputModel --resize union $TrainArrow -N $MaxEpochs *> $trainLog
Get-Content $trainLog -Tail 40
$trainExit = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($trainExit -ne 0) { throw "ketos train failed with exit $trainExit" }

& $Python ml/scripts/export_kraken_checkpoint.py --model-dir $OutputModel

Write-Host "=== Holdout guardrail (rollback if plateau/degradation) ==="
$guardrailExit = 0
& $Python ml/scripts/train_guardrail.py `
  --model-dir $OutputModel `
  --init-checkpoint $InitCheckpoint `
  --train-log $trainLog `
  --benchmark-output "ml/reports/benchmark_v5_frozen52.jsonl"
if ($LASTEXITCODE -eq 2) {
  $guardrailExit = 2
  Write-Host "GUARDRAIL: rolled back to init checkpoint — holdout did not improve safely."
} elseif ($LASTEXITCODE -ne 0) {
  throw "train_guardrail.py failed with exit $LASTEXITCODE"
}

if ($guardrailExit -eq 2) {
  Write-Host "v5 training finished with guardrail rollback (no degradation deployed)."
} else {
  Write-Host "v5 training complete; holdout guardrail passed."
}
