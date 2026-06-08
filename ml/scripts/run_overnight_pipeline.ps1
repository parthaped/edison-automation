param(
  [switch]$StopPhase3 = $true,
  [string]$LogFile = "ml/reports/overnight_pipeline.log"
)

$ErrorActionPreference = "Continue"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $RepoRoot

$VenvPython = Join-Path $RepoRoot "ml\.venv\Scripts\python.exe"
$LogPath = Join-Path $RepoRoot $LogFile
New-Item -ItemType Directory -Force -Path (Split-Path $LogPath) | Out-Null

function Write-Log([string]$Message) {
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  Add-Content -Path $LogPath -Value $line
  Write-Host $line
}

Write-Log "=== Overnight pipeline start ==="

if ($StopPhase3) {
  Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
    Where-Object { $_.CommandLine -match 'edison-htr-phase3' } |
    ForEach-Object {
      Write-Log "Stopping phase-3 trainer pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
  Get-CimInstance Win32_Process -Filter "Name='ketos.exe'" |
    Where-Object { $_.CommandLine -match 'edison-htr-phase3' } |
    ForEach-Object {
      Write-Log "Stopping phase-3 ketos pid=$($_.ProcessId)"
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

$upgradeProcs = Get-CimInstance Win32_Process -Filter "Name='python.exe'" |
  Where-Object { $_.CommandLine -match 'upgrade_gt_manifest' }
if ($upgradeProcs.Count -gt 1) {
  $keep = ($upgradeProcs | Where-Object { $_.CommandLine -match '\\.venv\\' } | Select-Object -First 1)
  foreach ($proc in $upgradeProcs) {
    if ($keep -and $proc.ProcessId -eq $keep.ProcessId) { continue }
    Write-Log "Stopping duplicate upgrade pid=$($proc.ProcessId)"
    Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

$env:PYTHONUNBUFFERED = "1"
$env:PYTHONUTF8 = "1"

Write-Log "Launching train_quality_curriculum.ps1"
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot "ml\scripts\train_quality_curriculum.ps1") 2>&1 |
  ForEach-Object {
    $line = "$_"
    Add-Content -Path $LogPath -Value $line -Encoding utf8
    Write-Host $line
  }

$exit = $LASTEXITCODE
Write-Log "=== Overnight pipeline finished exit=$exit ==="
exit $exit
