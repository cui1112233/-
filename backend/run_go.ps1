$env:GOPROXY = "https://goproxy.cn,direct"
$env:GO111MODULE = "on"

# Load .env
foreach ($line in Get-Content .env) {
    $line = $line.Trim()
    if ($line -and $line -notmatch "^#") {
        $parts = $line -split "=", 2
        if ($parts.Count -eq 2) {
            [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
        }
    }
}

Write-Host "Go env: GOPROXY=$env:GOPROXY"
Write-Host "MySQL: $env:QIANTIE_MYSQL_DSN"
Write-Host "Redis: $env:QIANTIE_REDIS_ADDR"

C:\PROGRA~1\Go\bin\go.exe run ./cmd/qiantie