param(
  [double]$TargetHoldoutAccuracy = 0.557,
  [double]$TargetReferenceRatio = 0.80,
  [int]$MaxRelabelRounds = 3,
  [int]$MaxEpochs = 30
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

$Python = Join-Path $RepoRoot "ml\.venv\Scripts\python.exe"

Write-Host "=== Kraken OCR goal pipeline ==="
Write-Host "  Holdout target: $([math]::Round($TargetHoldoutAccuracy * 100, 1))% line char acc (frozen 52 pages)"
Write-Host "  Reference target: $([math]::Round($TargetReferenceRatio * 100, 0))% of Gemini/reference OCR"

for ($round = 1; $round -le $MaxRelabelRounds; $round++) {
  Write-Host "`n=== Round $round / $MaxRelabelRounds ==="

  & powershell -NoProfile -File ml/scripts/train_gemini_v5.ps1 -MaxEpochs $MaxEpochs
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Round $round failed; retrying after relabel checkpoint advances."
    Start-Sleep -Seconds 30
    continue
  }

  $benchmark = "ml/reports/benchmark_gemini_v5_frozen52.jsonl"
  $guardrailReport = "ml/models/edison-htr-gemini-v5.mlmodel/guardrail_report.json"
  if (-not (Test-Path $benchmark)) {
    Write-Host "Benchmark missing after round $round"
    continue
  }
  if (Test-Path $guardrailReport) {
    $gr = Get-Content $guardrailReport -Raw | ConvertFrom-Json
    Write-Host "Guardrail: $($gr.action) — $($gr.reason)"
    if ($gr.action -eq "rollback") {
      Write-Host "Holdout did not improve; init model kept. Continuing relabel rounds."
      continue
    }
  }

  $holdout = & $Python -c @"
import json
from pathlib import Path
rows=[json.loads(l) for l in Path('$benchmark').read_text().splitlines() if l.strip()]
cers=[r['cer'] for r in rows if r.get('cer') is not None]
print(round(1-sum(cers)/len(cers), 4) if cers else 0)
"@
  Write-Host "Frozen 52-page holdout: $([math]::Round([double]$holdout * 100, 2))%"

  & $Python ml/scripts/compare_to_reference.py `
    --kraken-predictions $benchmark `
    --target-ratio $TargetReferenceRatio `
    --output "ml/reports/compare_gemini_v5_round$round.csv" 2>&1 | Select-Object -Last 5

  if ([double]$holdout -ge $TargetHoldoutAccuracy) {
    Write-Host "Holdout target reached."
    break
  }
}

Write-Host "Kraken OCR goal pipeline finished."
