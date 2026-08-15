$root = $PSScriptRoot
$node = (Get-Command node -ErrorAction Stop).Source
$nodeLog = Join-Path $root 'node-server.log'
$goLog = Join-Path $root 'go-server.log'

if (-not (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $node -ArgumentList 'server.js' -WorkingDirectory $root -RedirectStandardOutput $nodeLog -RedirectStandardError $nodeLog -WindowStyle Hidden
}
if (-not (Get-NetTCPConnection -State Listen -LocalPort 4000 -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath 'powershell.exe' -ArgumentList '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'backend\run_go.ps1') -WorkingDirectory (Join-Path $root 'backend') -RedirectStandardOutput $goLog -RedirectStandardError $goLog -WindowStyle Hidden
}
Start-Sleep -Seconds 3
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in 3000, 4000 } | Select-Object LocalAddress, LocalPort, OwningProcess
