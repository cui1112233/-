$outputPath = Join-Path $PSScriptRoot '.qiantie-go.stdout.log'
$errorPath = Join-Path $PSScriptRoot '.qiantie-go.stderr.log'
$pidPath = Join-Path $PSScriptRoot '.qiantie-go.pid'
Remove-Item $outputPath, $errorPath, $pidPath -ErrorAction SilentlyContinue
$process = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'run_go.ps1')) -WorkingDirectory $PSScriptRoot -RedirectStandardOutput $outputPath -RedirectStandardError $errorPath -PassThru
Set-Content -Path $pidPath -Value $process.Id
Write-Output $process.Id