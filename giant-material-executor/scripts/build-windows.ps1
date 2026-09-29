param(
  [string]$Version = "0.1.0",
  [string]$OutputRoot = "$(Join-Path $PSScriptRoot '..\dist\windows-x64')"
)

$ErrorActionPreference = "Stop"
$moduleRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$stage = Join-Path $OutputRoot "stage"
$binary = Join-Path $stage "GiantMaterialExecutor.exe"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force -Path $stage, (Join-Path $stage 'worker') | Out-Null

Push-Location $moduleRoot
try {
  $env:GOOS = "windows"
  $env:GOARCH = "amd64"
  $env:CGO_ENABLED = "0"
  & go build -trimpath -ldflags "-s -w -X main.version=$Version" -o $binary ./cmd/giant-material-executor
  if ($LASTEXITCODE -ne 0) { throw "go build failed" }
  Copy-Item (Join-Path $moduleRoot 'worker\ocr_worker.py') (Join-Path $stage 'worker\ocr_worker.py')
  Copy-Item (Join-Path $moduleRoot 'worker\requirements-lock.txt') (Join-Path $stage 'worker\requirements-lock.txt')
} finally {
  Pop-Location
}

$forbidden = Get-ChildItem -Recurse -File $stage | Where-Object {
  $_.Name -match '(?i)(model|paddle|onnx|.pt$|.pdmodel$|.pdiparams$|.bin$)'
}
if ($forbidden) {
  $names = ($forbidden | ForEach-Object FullName) -join ", "
  throw "OCR runtime/model files must not be included in the installer stage: $names"
}

$nsis = Get-Command makensis -ErrorAction SilentlyContinue
if ($null -eq $nsis) {
  Write-Warning "makensis was not found; executable stage is ready but installer was not built."
  exit 0
}

$installer = Join-Path $OutputRoot "GiantMaterialExecutor-$Version.exe"
& $nsis.Source "/DPRODUCT_VERSION=$Version" "/DINPUT_STAGE=$stage" "/DOUTPUT_FILE=$installer" (Join-Path $moduleRoot 'installer\giant-material-executor.nsi')
if ($LASTEXITCODE -ne 0) { throw "makensis failed" }
Write-Output $installer
