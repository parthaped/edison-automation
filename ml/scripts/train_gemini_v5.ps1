param(
  [string]$GatewayApiKey = "",
  [string]$InitCheckpoint = "",
  [string]$OutputModel = "ml/models/edison-htr-gemini-v5.mlmodel",
  [string]$TrainArrow = "ml/data/manifests/edison_recognition_gemini_v5.arrow",
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
if (-not $GatewayApiKey) {
  $GatewayApiKey = $env:EDISON_AI_GATEWAY_KEY
}

if (-not $GatewayApiKey) {
  throw "EDISON_AI_GATEWAY_KEY is required. Set in Vercel env, .env.local, or pass -GatewayApiKey."
}
$env:EDISON_AI_GATEWAY_KEY = $GatewayApiKey
# AI SDK / gateway client compatibility only — do not set this in Vercel dashboard.
$env:AI_GATEWAY_API_KEY = $GatewayApiKey

# Stop any in-flight v4 / duplicate training jobs.
Get-Process ketos -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process python -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
    if ($cmd -match 'ketos|auto_iterate|finetune_v4|upgrade_gt|build_confidence') {
      Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
    }
  } catch {}
}

if (-not $InitCheckpoint) {
  $v5Best = Get-ChildItem "ml/models/edison-htr-v5.mlmodel/checkpoint_01-0.8366.ckpt" -ErrorAction SilentlyContinue
  if (-not $v5Best) {
    $v5Best = Get-ChildItem "ml/models/edison-htr-v5.mlmodel/checkpoint_*.ckpt" -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -notmatch 'abort' } |
      Sort-Object { if ($_.Name -match '-(\d+\.\d+)\.ckpt$') { [double]$Matches[1] } else { 0 } } -Descending |
      Select-Object -First 1
  }
  $qualityBest = "ml/models/edison-htr-quality.mlmodel/checkpoint_04-0.9179.ckpt"
  if ($v5Best) {
    $InitCheckpoint = $v5Best.FullName.Replace("$RepoRoot\", "").Replace("\", "/")
    Write-Host "Init from most recent v5 checkpoint: $InitCheckpoint"
  } elseif (Test-Path $qualityBest) {
    $InitCheckpoint = $qualityBest
    Write-Host "Init from quality model: $InitCheckpoint"
  } else {
    throw "No init checkpoint found."
  }
}

Write-Host "=== Gemini v5 training plan ==="
Write-Host "  Gateway: Vercel AI Gateway (google/gemini-2.5-flash)"
Write-Host "  Init: $InitCheckpoint"
Write-Host "  Output: $OutputModel"
Write-Host "  Goal: beat 55.7% line char acc on frozen 52-page holdout"

Write-Host "=== Verifying Gemini gateway auth (live API probe) ==="
& $Python ml/scripts/test_gateway_auth.py
if ($LASTEXITCODE -ne 0) {
  throw "Gemini gateway probe failed. Check EDISON_AI_GATEWAY_KEY in .env.local / Vercel env (401=bad key, 503=retry later)."
}

if (-not $SkipRelabel) {
  Write-Host "=== Relabeling v4 train pages with Gemini (force vision) ==="
  & $Python ml/scripts/relabel_gemini_training.py `
    --resume `
    --demote-low-quality `
    --skip-forced-align `
    --delay-seconds 2
  if ($LASTEXITCODE -ne 0) { throw "Gemini relabel failed." }
}

if (-not $SkipPrepare) {
  & $Python ml/scripts/prepare_gemini_v5.py
  if ($LASTEXITCODE -ne 0) { throw "Gemini v5 curation failed." }

  & $Python ml/scripts/compile_kraken_dataset.py `
    --page-list "ml/data/manifests/gemini_v5_train_pagexml.txt" `
    --output $TrainArrow `
    --num-workers 0
  if ($LASTEXITCODE -ne 0) { throw "Dataset compile failed." }
}

if (-not (Test-Path $InitCheckpoint)) {
  throw "Init checkpoint not found: $InitCheckpoint"
}

New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

Write-Host "=== Starting ketos train ($MaxEpochs epochs) ==="
$prevEap = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$trainLog = "ml/reports/gemini_v5_train.log"
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
  --benchmark-output "ml/reports/benchmark_gemini_v5_frozen52.jsonl" `
  --target-holdout 0.557
if ($LASTEXITCODE -eq 2) {
  $guardrailExit = 2
  Write-Host "GUARDRAIL: rolled back to init checkpoint — holdout did not improve safely."
} elseif ($LASTEXITCODE -ne 0) {
  throw "train_guardrail.py failed with exit $LASTEXITCODE"
}

$Promoted = Join-Path $OutputModel "promoted_guardrail.safetensors"
if (Test-Path $Promoted) {
  $report = Get-Content (Join-Path $OutputModel "guardrail_report.json") -Raw | ConvertFrom-Json
  Write-Host "Promoted model: $($report.promoted_safetensors) ($($report.action): $($report.reason))"
  Write-Host "Holdout: baseline $($report.baseline_holdout) -> candidate $($report.candidate_holdout)"
} else {
  Write-Warning "No promoted_guardrail.safetensors — check guardrail_report.json"
}

if ($guardrailExit -eq 2) {
  Write-Host "Gemini v5 training finished with guardrail rollback (no degradation deployed)."
} else {
  Write-Host "Gemini v5 training complete; holdout guardrail passed."
}
