param(
  [int]$MaxRounds = 6,
  [int]$PollSeconds = 120
)

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot
$env:PYTHONUNBUFFERED = "1"
$env:PYTHONUTF8 = "1"

$Python = Join-Path $RepoRoot "ml\.venv\Scripts\python.exe"
& $Python ml/scripts/auto_iterate_quality.py --max-rounds $MaxRounds --poll-seconds $PollSeconds
