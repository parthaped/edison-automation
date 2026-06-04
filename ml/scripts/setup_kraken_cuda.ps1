# Bootstrap Kraken 7 + CUDA PyTorch on the Edison ML venv (Windows / T1200).
param(
  [string]$VenvDir = "ml\.venv",
  [string]$CudaIndex = "https://download.pytorch.org/whl/cu124"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

if (-not (Test-Path $VenvDir)) {
  python -m venv $VenvDir
}

& "$VenvDir\Scripts\Activate.ps1"
python -m pip install --upgrade pip
pip install torch torchvision --index-url $CudaIndex
pip install -r ml\requirements-kraken-cuda.txt
python ml\scripts\verify_cuda.py
if ($LASTEXITCODE -ne 0) { throw "CUDA verification failed." }

Write-Host ""
Write-Host "Next: download a Kraken 7 recognition model into ml/models/ (see ml/docs/kraken-local-ocr.md)."
Write-Host "GPU smoke test:"
Write-Host "  kraken -i page.jpg stdout --device cuda:0 --precision bf16-mixed segment -bl ocr -m ml\models\<model> -B 16 --num-line-workers 4"
