# Bootstrap PaddleOCR-VL-1.6 in an isolated venv (does not touch Kraken or Surya venvs).
param(
  [string]$VenvDir = "ml\.venv-paddle-vl",
  [ValidateSet("gpu", "cpu")]
  [string]$Device = "gpu"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

if (-not (Test-Path $VenvDir)) {
  python -m venv $VenvDir
}

& "$VenvDir\Scripts\Activate.ps1"
python -m pip install --upgrade pip

if ($Device -eq "gpu") {
  python -m pip install paddlepaddle-gpu==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cu126/
} else {
  python -m pip install paddlepaddle==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
}
if ($LASTEXITCODE -ne 0) { throw "PaddlePaddle install failed." }

pip install -r ml\requirements-paddleocr-vl.txt
if ($LASTEXITCODE -ne 0) { throw "PaddleOCR-VL dependency install failed." }

Write-Host ""
Write-Host "Use this venv for PaddleOCR-VL only:"
Write-Host "  $VenvDir\Scripts\Activate.ps1"
Write-Host "  python ml/scripts/paddleocr_vl_pipeline.py --input `"C:\path\to\file.pdf`""
Write-Host ""
