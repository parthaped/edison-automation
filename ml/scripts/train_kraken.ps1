param(

  [string]$PageXmlDir = "ml/data/pagexml",

  [string]$PageList = "",

  [string]$OutputModel = "ml/models/edison-htr.mlmodel",

  [string]$CompiledData = "ml/data/manifests/edison_recognition.arrow",

  [string]$BaseModel = "",

  [int]$BatchSize = 0,

  [switch]$Augment,

  [string]$Resize = "",

  [int]$MaxEpochs = 0,

  [string[]]$TrainArgs = @()

)



$ErrorActionPreference = "Stop"



if (-not (Get-Command ketos -ErrorAction SilentlyContinue)) {

  throw "Kraken ketos CLI was not found. Install kraken in your Python ML environment."

}



if ($PageList -ne "") {

  $xmlFiles = Get-Content -Path $PageList | Where-Object { $_.Trim() -ne "" }

} else {

  $xmlFiles = Get-ChildItem -Path $PageXmlDir -Filter "*.xml" | ForEach-Object { $_.FullName }

}



if ($xmlFiles.Count -eq 0) {

  throw "No PAGE XML files found in $PageXmlDir"

}



New-Item -ItemType Directory -Force -Path (Split-Path $CompiledData) | Out-Null

New-Item -ItemType Directory -Force -Path (Split-Path $OutputModel) | Out-Null



$python = (Get-Command python -ErrorAction SilentlyContinue)

if ($python) {

  if ($PageList -ne "") {

    & $python.Source ml/scripts/compile_kraken_dataset.py --page-list $PageList --output $CompiledData --num-workers 0

  } else {

    & $python.Source ml/scripts/compile_kraken_dataset.py --pagexml-dir $PageXmlDir --output $CompiledData --num-workers 0

  }

} else {

  ketos compile -f page -o $CompiledData @xmlFiles

}



$extraArgs = @()

if ($BatchSize -gt 0) {

  $extraArgs += "-B"

  $extraArgs += "$BatchSize"

}

if ($Augment) {

  $extraArgs += "--augment"

}

if ($Resize -ne "") {

  $extraArgs += "--resize"

  $extraArgs += $Resize

}

if ($MaxEpochs -gt 0) {

  $extraArgs += "-N"

  $extraArgs += "$MaxEpochs"

}

if ($TrainArgs.Count -gt 0) {

  $extraArgs += $TrainArgs

}



$env:PYTHONUTF8 = "1"

if ($BaseModel -ne "") {

  ketos --workers 0 train -f binary -i $BaseModel -o $OutputModel @extraArgs $CompiledData

} else {

  ketos --workers 0 train -f binary -o $OutputModel @extraArgs $CompiledData

}

