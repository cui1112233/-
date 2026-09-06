param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath
)

$ErrorActionPreference = 'Stop'

function Assert-True {
  param(
    [bool]$Condition,
    [string]$Message
  )
  if (-not $Condition) { throw $Message }
}

function Install-Silently {
  param([string]$Path)
  $process = Start-Process -FilePath $Path -ArgumentList '/S' -PassThru -Wait
  if ($process.ExitCode -ne 0) {
    throw "silent installer failed with exit code $($process.ExitCode)"
  }
}

$resolvedInstaller = (Resolve-Path $InstallerPath).Path
$localAppData = [Environment]::GetFolderPath('LocalApplicationData')
$programsRoot = Join-Path $localAppData 'Programs'
$expectedInstallDir = Join-Path $programsRoot 'yizhan-doubao-local-executor'
$expectedExe = Join-Path $expectedInstallDir '一战晟铭豆包执行器.exe'
$protocolRoot = 'HKCU:\Software\Classes\yizhan-executor'
$protocolCommandKey = 'HKCU:\Software\Classes\yizhan-executor\shell\open\command'

Write-Host "Installer: $resolvedInstaller"
Write-Host "Expected install directory: $expectedInstallDir"

Install-Silently -Path $resolvedInstaller
Assert-True (Test-Path $expectedExe) "installed executor was not found at expected path: $expectedExe"
$firstInstallPath = (Resolve-Path $expectedExe).Path

Assert-True (Test-Path $protocolRoot) 'yizhan-executor protocol registry key was not created'
Assert-True (Test-Path $protocolCommandKey) 'yizhan-executor protocol open command was not created'
$protocolCommand = (Get-Item $protocolCommandKey).GetValue('')
Assert-True (-not [string]::IsNullOrWhiteSpace($protocolCommand)) 'yizhan-executor protocol open command is empty'
Assert-True ($protocolCommand -like "*$expectedExe*") 'yizhan-executor protocol does not point to the installed executor'
Assert-True ($protocolCommand -match '%1') 'yizhan-executor protocol command does not forward the requested URL'

# Install the same package a second time. NSIS must overwrite/update the same
# formal installation instead of creating a second program directory.
Install-Silently -Path $resolvedInstaller
Assert-True (Test-Path $expectedExe) 'executor disappeared after second install'
$secondInstallPath = (Resolve-Path $expectedExe).Path
Assert-True ($firstInstallPath -eq $secondInstallPath) 'second install did not reuse the original executor path'

$matchingInstallDirs = @(
  Get-ChildItem -Path $programsRoot -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -like 'yizhan-doubao-local-executor*' }
)
Assert-True ($matchingInstallDirs.Count -eq 1) "duplicate install directories detected: $($matchingInstallDirs.Count)"

Assert-True (Test-Path $protocolCommandKey) 'protocol registration was lost after overwrite install'
$protocolCommandAfter = (Get-Item $protocolCommandKey).GetValue('')
Assert-True ($protocolCommandAfter -like "*$expectedExe*") 'protocol registration points to the wrong executable after overwrite install'

Write-Host "Windows installer overwrite smoke verification passed"
Write-Host "firstInstallPath=$firstInstallPath"
Write-Host "secondInstallPath=$secondInstallPath"
Write-Host "protocolCommand=$protocolCommandAfter"
