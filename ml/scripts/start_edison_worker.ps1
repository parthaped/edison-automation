# Start the Edison OCR pull worker on this laptop (PaddleOCR-VL-1.6 by default).
param(
  [string]$VenvDir = "ml\.venv-paddle-vl",
  [string]$Backend = "paddleocr-vl",
  [string]$VercelUrl = $env:EDISON_VERCEL_URL,
  [string]$WorkerSecret = $env:EDISON_OCR_WORKER_SECRET,
  [string]$WorkerId = "laptop-paddle-vl",
  [int]$IdleSleep = 3
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

if (-not $VercelUrl) {
  $VercelUrl = "https://edison-papers-research.vercel.app"
}
if (-not $WorkerSecret) {
  throw "Set EDISON_OCR_WORKER_SECRET to match Vercel."
}
if (-not (Test-Path $VenvDir)) {
  throw "Missing venv at $VenvDir. Run ml\scripts\setup_paddleocr_vl.ps1 first."
}

$env:EDISON_VERCEL_URL = $VercelUrl
$env:EDISON_OCR_WORKER_SECRET = $WorkerSecret
$env:EDISON_OCR_WORKER_ID = $WorkerId
$env:EDISON_OCR_BACKEND = $Backend
$env:PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK = "True"
$env:PYTHONIOENCODING = "utf-8"

Write-Host "Checking worker auth before loading OCR models..."
& "$VenvDir\Scripts\python.exe" ml\scripts\test_ocr_worker_auth.py `
  --vercel-url $VercelUrl `
  --worker-secret $WorkerSecret
if ($LASTEXITCODE -ne 0) {
  throw "Worker auth check failed. Fix Vercel env vars or local EDISON_OCR_WORKER_SECRET, then retry."
}

& "$VenvDir\Scripts\python.exe" ml\scripts\edison_ocr_worker.py `
  --backend $Backend `
  --vercel-url $VercelUrl `
  --worker-secret $WorkerSecret `
  --worker-id $WorkerId `
  --idle-sleep $IdleSleep
