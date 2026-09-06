param(
  [double]$MaxInstallerMiB = 90,
  [string]$Channel = 'stable',
  [string]$MinimumVersion = '1.0.3'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $RepoRoot 'backend'
$ExecutorDir = Join-Path $RepoRoot 'local-executor'
$FrontendDir = Join-Path $RepoRoot 'frontend'
$ExecutorPackagePath = Join-Path $ExecutorDir 'package.json'
$ExecutorDistDir = Join-Path $ExecutorDir 'dist'
$ReportPath = Join-Path $ExecutorDistDir 'local-validation-report.json'

function Invoke-NativeStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(Mandatory = $true)][string[]]$Arguments
  )

  Write-Host "`n=== $Name ===" -ForegroundColor Cyan
  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$Name failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

if ($env:OS -ne 'Windows_NT') {
  throw 'Phase 1 local validation must run on Windows because it builds the NSIS Windows installer.'
}
if ($Channel -ne 'stable') {
  throw 'Phase 1 release-candidate validation must use channel=stable.'
}
if ($MinimumVersion -ne '1.0.3') {
  throw 'Phase 1 release-candidate validation requires minimumVersion=1.0.3.'
}

Get-Command node -ErrorAction Stop | Out-Null
Get-Command npm -ErrorAction Stop | Out-Null
Get-Command go -ErrorAction Stop | Out-Null
Get-Command git -ErrorAction Stop | Out-Null
$npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCommand) {
  $npmCommand = Get-Command npm -ErrorAction Stop
}
$npmPath = $npmCommand.Source

$nodeVersion = (& node --version).Trim()
$npmVersion = (& $npmPath --version).Trim()
$goVersion = (& go version).Trim()
$gitVersion = (& git --version).Trim()
Write-Host "Node: $nodeVersion"
Write-Host "npm:  $npmVersion"
Write-Host "Go:   $goVersion"
Write-Host "Git:  $gitVersion"

$package = Get-Content -Raw $ExecutorPackagePath | ConvertFrom-Json
$version = [string]$package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') {
  throw "Executor package.json version is not strict semver: $version"
}
if ($version -ne '1.0.4') {
  throw "Phase 1 release candidate must be version 1.0.4, got $version"
}

# backend: go test ./...
Invoke-NativeStep -Name 'Backend Go tests' -WorkingDirectory $BackendDir -FilePath 'go' -Arguments @('test', './...')

Invoke-NativeStep -Name 'Root dependency install' -WorkingDirectory $RepoRoot -FilePath $npmPath -Arguments @('ci')
$routeTests = @((Join-Path $RepoRoot 'test/local-executor-updates.test.js'))
$routeTests += @(Get-ChildItem -Path (Join-Path $RepoRoot 'test') -Filter 'script-video*.test.js' -File -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
if (-not (Test-Path $routeTests[0])) {
  throw 'Required root route test is missing: test/local-executor-updates.test.js'
}
# node --test test/local-executor-updates.test.js test/script-video*.test.js
Invoke-NativeStep -Name 'Node executor route tests' -WorkingDirectory $RepoRoot -FilePath 'node' -Arguments (@('--test') + $routeTests)

Invoke-NativeStep -Name 'Executor dependency install' -WorkingDirectory $ExecutorDir -FilePath $npmPath -Arguments @('install')
# npm test
Invoke-NativeStep -Name 'Executor tests' -WorkingDirectory $ExecutorDir -FilePath $npmPath -Arguments @('test')
# npm run check
Invoke-NativeStep -Name 'Executor syntax check' -WorkingDirectory $ExecutorDir -FilePath $npmPath -Arguments @('run', 'check')

Invoke-NativeStep -Name 'Frontend dependency install' -WorkingDirectory $FrontendDir -FilePath $npmPath -Arguments @('ci')
# npm test
Invoke-NativeStep -Name 'Frontend tests' -WorkingDirectory $FrontendDir -FilePath $npmPath -Arguments @('test')
# npm run build
Invoke-NativeStep -Name 'Frontend build' -WorkingDirectory $FrontendDir -FilePath $npmPath -Arguments @('run', 'build')

if (Test-Path $ExecutorDistDir) {
  Remove-Item -Recurse -Force $ExecutorDistDir
}
# npm run dist:win
Invoke-NativeStep -Name 'Windows NSIS build' -WorkingDirectory $ExecutorDir -FilePath $npmPath -Arguments @('run', 'dist:win')

$canonicalName = "yizhan-local-executor-v88-$version-win-x64.exe"
$canonicalPath = Join-Path $ExecutorDistDir $canonicalName
$installer = Get-ChildItem -Path $ExecutorDistDir -Filter '*.exe' -File |
  Where-Object { $_.FullName -ne $canonicalPath } |
  Sort-Object Length -Descending |
  Select-Object -First 1
if (-not $installer) {
  throw 'Windows NSIS installer was not produced.'
}
Copy-Item $installer.FullName $canonicalPath -Force

$sizeBytes = (Get-Item $canonicalPath).Length
$sizeMiB = [Math]::Round($sizeBytes / 1MB, 2)
if ($sizeBytes -gt ($MaxInstallerMiB * 1MB)) {
  throw "Installer is too large: $sizeMiB MiB exceeds Phase 1 ceiling $MaxInstallerMiB MiB"
}

# Get-FileHash SHA256
$sha256 = (Get-FileHash -Path $canonicalPath -Algorithm SHA256).Hash.ToLowerInvariant()
$commit = (& git -C $RepoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') {
  throw 'Unable to resolve the current Git commit SHA.'
}

$report = [ordered]@{
  schemaVersion = 1
  result = 'passed'
  version = $version
  minimumVersion = $MinimumVersion
  channel = $Channel
  platform = 'win32'
  arch = 'x64'
  file = $canonicalName
  installerPath = $canonicalPath
  sizeBytes = $sizeBytes
  sizeMiB = $sizeMiB
  maxInstallerMiB = $MaxInstallerMiB
  sha256 = $sha256
  commit = $commit
  verifiedAtUtc = (Get-Date).ToUniversalTime().ToString('o')
  verification = @(
    'backend: go test ./...'
    'root: local executor/script-video route tests'
    'local-executor: npm test'
    'local-executor: npm run check'
    'frontend: npm test'
    'frontend: npm run build'
    'local-executor: npm run dist:win'
    'installer: SHA256 and <= 90 MiB gate'
  )
}

$report | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 $ReportPath

Write-Host "`n=== Phase 1 local validation PASSED ===" -ForegroundColor Green
Write-Host "Version:        $version"
Write-Host "Channel:        $Channel"
Write-Host "Minimum:        $MinimumVersion"
Write-Host "Installer:      $canonicalPath"
Write-Host "Size:           $sizeBytes bytes ($sizeMiB MiB)"
Write-Host "Max size:       $MaxInstallerMiB MiB"
Write-Host "SHA256:         $sha256"
Write-Host "Commit:         $commit"
Write-Host "Report:         $ReportPath"
