$srcDir = Get-ChildItem "f:\脚本测试\chengming" -Directory -Filter "*Hotfix*" | Select-Object -First 1 -ExpandProperty FullName
$src = Join-Path $srcDir "_internal\app"
$dest = "f:\脚本测试\chengming\qiantie\public\novel-panel\workbench"
Write-Output "SRC: $src"
Write-Output "DEST: $dest"
Copy-Item (Join-Path $src "static\app.js") (Join-Path $dest "app.js") -Force
Copy-Item (Join-Path $src "static\style.css") (Join-Path $dest "style.css") -Force
Copy-Item (Join-Path $src "static\character-core\character-core.js") (Join-Path $dest "character-core\character-core.js") -Force
Write-Output "All files copied successfully."