param(
  [string]$PageXmlDir = "ml/data/pagexml",
  [string]$OutputModel = "ml/models/edison-htr.mlmodel",
  [string]$CompiledData = "ml/data/manifests/edison_recognition.arrow",
  [string]$BaseModel = ""
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command ketos -ErrorAction SilentlyContinue)) {
  throw "Kraken ketos CLI was not found. Install kraken in your Python ML environment."
}

$xmlFiles = Get-ChildItem -Path $PageXmlDir -Filter "*.xml" | ForEach-Object { $_.FullName }
if ($xmlFiles.Count -eq 0) {
  throw "No PAGE XML files found in $PageXmlDir"
}

New-Item -ItemType Directory -Force -Path (Split-Path $CompiledData) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null

ketos compile -f page -o $CompiledData @xmlFiles

if ($BaseModel -ne "") {
  ketos train -f binary -i $BaseModel -o $OutputModel $CompiledData
} else {
  ketos train -f binary -o $OutputModel $CompiledData
}
