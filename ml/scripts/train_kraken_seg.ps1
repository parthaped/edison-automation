param(
  [string]$PageXmlDir = "ml/data/pagexml",
  [string]$PageList = "",
  [string]$OutputModel = "ml/models/edison-seg.mlmodel",
  [string]$BaseModel = "",
  [string[]]$TrainArgs = @()
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ketos -ErrorAction SilentlyContinue)) {
  throw "Kraken ketos CLI was not found. Install kraken in your Python ML environment."
}

if ($PageList -ne "") {
  $xmlFiles = Get-Content -Path $PageList | Where-Object { $_.Trim() -ne "" } | ForEach-Object { (Resolve-Path $_).Path }
} else {
  $xmlFiles = Get-ChildItem -Path $PageXmlDir -Filter "*.xml" | ForEach-Object { $_.FullName }
}

if ($xmlFiles.Count -eq 0) {
  throw "No PAGE XML files found."
}

New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

$env:PYTHONUTF8 = "1"
$segArgs = @("--workers", "0", "segtrain", "-f", "page", "-o", $OutputModel) + $TrainArgs + $xmlFiles
if ($BaseModel -ne "") {
  $segArgs = @("--workers", "0", "segtrain", "-f", "page", "-i", $BaseModel, "-o", $OutputModel) + $TrainArgs + $xmlFiles
}

& ketos @segArgs

Write-Host "Segmentation model written to $OutputModel"
