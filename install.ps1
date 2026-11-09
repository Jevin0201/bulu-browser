$ErrorActionPreference = "Stop"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $env:LOCALAPPDATA "bulu-browser\app"
$baseDir = Join-Path $env:LOCALAPPDATA "bulu-browser"
$profileDir = Join-Path $baseDir "profile"
$wbDir = Join-Path $env:USERPROFILE ".workbuddy"
$skillDir = Join-Path $wbDir "skills\bulu-browser"
$mcpFile = Join-Path $wbDir "mcp.json"

Write-Host ""
Write-Host "布噜浏览器专家 - 安装" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "错误: 找不到 node。请先安装 Node.js 20 或更高版本。" -ForegroundColor Red
    exit 1
}
$nodeVersion = (& node --version).Trim()
Write-Host "node: $nodeVersion  ($($nodeCmd.Source))"

if (-not (Test-Path (Join-Path $here "src\index.mjs"))) {
    Write-Host "错误: 安装包不完整，找不到 src\index.mjs。请在完整目录下运行本脚本。" -ForegroundColor Red
    exit 1
}

Write-Host "`n[1/4] 复制程序文件 -> $appDir"
if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Copy-Item (Join-Path $here "src") -Destination $appDir -Recurse -Force
Copy-Item (Join-Path $here "package.json") -Destination $appDir -Force
$assetSource = Join-Path $here "assets"
if (Test-Path $assetSource) { Copy-Item $assetSource -Destination $appDir -Recurse -Force }
foreach ($script in @("create-shortcut.ps1", "uninstall.ps1")) {
    $source = Join-Path $here $script
    if (Test-Path $source) { Copy-Item $source -Destination $appDir -Force }
}
$pwSource = Join-Path $here "node_modules\playwright-core"
if (-not (Test-Path $pwSource)) {
    Write-Host "错误: 缺少 node_modules\playwright-core。" -ForegroundColor Red
    exit 1
}
New-Item -ItemType Directory -Path (Join-Path $appDir "node_modules") -Force | Out-Null
Copy-Item $pwSource -Destination (Join-Path $appDir "node_modules\playwright-core") -Recurse -Force
New-Item -ItemType Directory -Path $profileDir -Force | Out-Null

Write-Host "[2/4] 安装技能 -> $skillDir"
if (Test-Path $skillDir) { Remove-Item $skillDir -Recurse -Force }
New-Item -ItemType Directory -Path $skillDir -Force | Out-Null
Copy-Item (Join-Path $here "skill\SKILL.md") -Destination $skillDir -Force

Write-Host "[3/4] 注册 MCP 工具 -> $mcpFile"
if (-not (Test-Path $wbDir)) { New-Item -ItemType Directory -Path $wbDir -Force | Out-Null }
$config = $null
if (Test-Path $mcpFile) {
    Copy-Item $mcpFile "$mcpFile.bak" -Force
    try {
        $raw = Get-Content $mcpFile -Raw -Encoding UTF8
        if ($raw.Trim().Length -gt 0) { $config = $raw | ConvertFrom-Json }
    } catch {
        Write-Host "  警告: 现有 mcp.json 无法解析，已备份为 mcp.json.bak，将新建配置。" -ForegroundColor Yellow
        $config = $null
    }
}
if ($null -eq $config) { $config = New-Object PSObject }
if (-not ($config.PSObject.Properties.Name -contains "mcpServers")) {
    $config | Add-Member -MemberType NoteProperty -Name "mcpServers" -Value (New-Object PSObject)
}
$entry = New-Object PSObject
$entry | Add-Member -MemberType NoteProperty -Name "command" -Value "node"
$entry | Add-Member -MemberType NoteProperty -Name "args" -Value @((Join-Path $appDir "src\index.mjs"))
$entry | Add-Member -MemberType NoteProperty -Name "env" -Value (New-Object PSObject)

$servers = $config.mcpServers
if ($servers.PSObject.Properties.Name -contains "bulu-browser") {
    $servers."bulu-browser" = $entry
} else {
    $servers | Add-Member -MemberType NoteProperty -Name "bulu-browser" -Value $entry
}
$json = $config | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($mcpFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "  已写入配置（原文件备份为 mcp.json.bak）"

Write-Host "[4/4] 自检（会短暂启动一次 Chrome）"
$check = Join-Path $appDir "src\index.mjs"
$prevPolicy = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$output = & node $check --check 2>&1
$checkCode = $LASTEXITCODE
$ErrorActionPreference = $prevPolicy
if ($checkCode -eq 0) {
    Write-Host "  自检通过" -ForegroundColor Green
} else {
    Write-Host "  自检失败，输出如下：" -ForegroundColor Yellow
    $output | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
Write-Host "安装完成。" -ForegroundColor Green
Write-Host ""
Write-Host "下一步：" -ForegroundColor Cyan
Write-Host "  1. 重启 WorkBuddy（或新开一个对话），让 MCP 生效"
Write-Host "  2. 打开 连接器 / 插件管理，在自定义 MCP 里找到 bulu-browser 并点『信任』"
Write-Host "  3. 之后直接说：打开 xxx 看看 / 帮我填这个表单"
Write-Host ""
Write-Host "浏览器数据目录: $profileDir"
Write-Host ("卸载: powershell -ExecutionPolicy Bypass -File `"" + $here + "\uninstall.ps1`"")
Write-Host ""
