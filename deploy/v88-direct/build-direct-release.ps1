<#
V88 代码直传打包脚本（在你的 Windows 电脑上跑）。

做的事：
  1. 取当前 Git 版本号（SHA）；
  2. 把 Go 后端交叉编译成 1 个 Linux 单文件；
  3. 构建前端，并按线上 Dockerfile 的老规矩补好 downloads、batch-rewrite 脚本；
  4. 组装成服务器要的成品目录并压缩成一个 tar.gz。

全程只在你电脑本地操作，不碰服务器、不碰 Docker、不碰国外镜像。
产物：release/v88-direct-<sha>.tar.gz

用法（在仓库根目录）：
  powershell -ExecutionPolicy Bypass -File deploy/v88-direct/build-direct-release.ps1
#>
[CmdletBinding()]
param(
    [string]$RepoRoot = ''
)

if (-not $RepoRoot) { $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path }
$ErrorActionPreference = 'Stop'
function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }
function Die($msg) { Write-Host "错误：$msg" -ForegroundColor Red; exit 1 }

Set-Location $RepoRoot

# 1) 工具与版本检查 ----------------------------------------------------------
foreach ($c in 'git', 'go', 'npm', 'tar') {
    if (-not (Get-Command $c -ErrorAction SilentlyContinue)) { Die "没找到 $c，请先安装后再跑。" }
}
$sha = (git rev-parse HEAD 2>$null)
if (-not $sha) { Die '当前目录不是 Git 仓库。' }
$sha = $sha.Trim()
if (-not (git rev-parse --git-dir 2>$null)) { Die '必须在 v88 仓库里运行。' }
$dirty = (git status --porcelain 2>$null | Measure-Object -Line).Lines
if ($dirty -gt 0) {
    Die "工作区有 $dirty 处未提交改动。请先把改动提交并推送到 v88，再打包（保证线上版本能追到 Git 编号）。"
}
Write-Host "打包版本 SHA = $sha" -ForegroundColor Green

$staging = Join-Path $RepoRoot ".direct-staging"
$goOut   = Join-Path $staging 'go\qiantie'
$nodeOut = Join-Path $staging 'node'
if (Test-Path $staging) { Remove-Item $staging -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Join-Path $staging 'go'), $nodeOut | Out-Null
# The production compose file mounts persistent volumes at these child paths.
# They must already exist in the read-only /app release mount before Docker
# attaches those volumes, otherwise a first direct release cannot start Node.
New-Item -ItemType Directory -Force -Path (Join-Path $nodeOut 'data'), (Join-Path $nodeOut 'outputs') | Out-Null

# 2) 交叉编译 Go（Linux amd64 单文件，与线上镜像同架构）---------------------
Step '交叉编译 Go 后端（linux/amd64 单文件）'
Push-Location (Join-Path $RepoRoot 'backend')
try {
    $env:GOOS = 'linux'; $env:GOARCH = 'amd64'; $env:CGO_ENABLED = '0'
    go build -trimpath -o $goOut ./cmd/qiantie
    if ($LASTEXITCODE -ne 0) { Die 'Go 编译失败。' }
} finally {
    Remove-Item Env:GOOS, Env:GOARCH, Env:CGO_ENABLED -ErrorAction SilentlyContinue
    Pop-Location
}

# 3) 前端依赖与构建 ----------------------------------------------------------
$fe = Join-Path $RepoRoot 'frontend'
if (-not (Test-Path (Join-Path $fe 'node_modules'))) {
    Step '安装前端依赖（仅首次较慢）'
    Push-Location $fe; try { npm ci; if ($LASTEXITCODE -ne 0) { Die '前端依赖安装失败。' } } finally { Pop-Location }
}
Step '构建前端'
Push-Location $fe; try { npm run build; if ($LASTEXITCODE -ne 0) { Die '前端构建失败。' } } finally { Pop-Location }

# 4) Node 生产依赖（纯 JS，跨平台；服务器上没有 npm，必须在本地备好）--------
if (-not (Test-Path (Join-Path $RepoRoot 'node_modules'))) {
    Step '安装 Node 生产依赖'
    npm ci --omit=dev
    if ($LASTEXITCODE -ne 0) { Die 'Node 生产依赖安装失败。' }
}

# 5) 组装 node 成品目录（与线上 Dockerfile 的 COPY 清单一一对应）-----------
Step '组装 Node 成品目录'
$copyItems = 'package.json', 'package-lock.json', 'server.js', 'app.js', 'index.html',
             'lib', 'middleware', 'pets', 'prompts', 'public', 'routes', 'node_modules'
foreach ($item in $copyItems) {
    $src = Join-Path $RepoRoot $item
    if (Test-Path $src) { Copy-Item $src (Join-Path $nodeOut $item) -Recurse -Force }
}
Copy-Item (Join-Path $fe 'dist') (Join-Path $nodeOut 'frontend\dist') -Recurse -Force

# 5a) Dockerfile 第 23 行：下载区（执行器安装包等），vite 一般已拷，幂等补齐。
# 注意：必须拷目录“内容”，否则目标已存在时会套出 downloads/downloads 双层。
$dlSrc = Join-Path $fe 'public\downloads'
$dlDst = Join-Path $nodeOut 'frontend\dist\downloads'
if (Test-Path $dlSrc) {
    New-Item -ItemType Directory -Force -Path $dlDst | Out-Null
    Copy-Item (Join-Path $dlSrc '*') $dlDst -Recurse -Force
}

# 5b) Dockerfile 第 28-43 行：batch-rewrite 兼容脚本。
$brOut = Join-Path $nodeOut 'frontend\dist\batch-rewrite'
New-Item -ItemType Directory -Force -Path $brOut | Out-Null
$feBr = Join-Path $fe 'public\batch-rewrite'
if (Test-Path $feBr) { Copy-Item (Join-Path $feBr '*') $brOut -Recurse -Force }
$rootBr = Join-Path $RepoRoot 'public\batch-rewrite'
if (Test-Path $rootBr) { Copy-Item (Join-Path $rootBr '*') $brOut -Recurse -Force }

# 5c) Dockerfile 第 44 行：给 batch-rewrite/index.html 注入 3 个 hotfix 标签（幂等）。
$brIndex = Join-Path $brOut 'index.html'
if (Test-Path $brIndex) {
    $html = Get-Content $brIndex -Raw
    if ($html -notmatch 'qiantie-121-login-hotfix') {
        $inject = @'
    <script id="qiantie-121-login-hotfix" src="./121-login-hotfix.js?v=20260831-config-guard1"></script>
    <script id="qiantie-novel-fetch-interaction-feedback" src="./interaction-feedback.js?v=20260906-public-feedback1"></script>
    <script id="qiantie-novel-fetch-task-visibility" src="./task-visibility-hotfix.js?v=20260906-task-visibility1"></script>
  </body>
'@
        $html = $html -replace '</body>', ($inject -replace '\$', '$$$$')
        [System.IO.File]::WriteAllText($brIndex, $html, (New-Object System.Text.UTF8Encoding($false)))
        Write-Host '  已注入 batch-rewrite hotfix 标签'
    } else {
        Write-Host '  batch-rewrite hotfix 已存在，跳过注入'
    }
}

# 5d) 版本号文件（环境变量之外的第二道保险）。
[System.IO.File]::WriteAllText((Join-Path $nodeOut 'RELEASE-SHA'), "$sha`n", (New-Object System.Text.UTF8Encoding($false)))

# 6) 压缩成品 ----------------------------------------------------------------
Step '压缩成品 tar.gz'
$releaseDir = Join-Path $RepoRoot 'release'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$tarball = Join-Path $releaseDir "v88-direct-$sha.tar.gz"
if (Test-Path $tarball) { Remove-Item $tarball -Force }
Push-Location $staging
try {
    tar -czf $tarball go node
    if ($LASTEXITCODE -ne 0) { Die '打包失败。' }
} finally { Pop-Location }

$sizeMB = [math]::Round((Get-Item $tarball).Length / 1MB, 1)
Write-Host ""
Write-Host "完成！成品包：$tarball ($sizeMB MB)" -ForegroundColor Green
Write-Host "下一步：上传并在服务器激活（由部署流程通过 SSH 执行）。" -ForegroundColor Green
