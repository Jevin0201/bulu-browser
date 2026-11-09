$ErrorActionPreference = "Stop"

$appBase = Join-Path $env:LOCALAPPDATA "bulu-browser"
$skillDir = Join-Path $env:USERPROFILE ".workbuddy\skills\bulu-browser"
$mcpFile = Join-Path $env:USERPROFILE ".workbuddy\mcp.json"

Write-Host ""
Write-Host "布噜浏览器专家 - 卸载" -ForegroundColor Cyan
Write-Host "=====================" -ForegroundColor Cyan

Get-Process chrome -ErrorAction SilentlyContinue | Where-Object {
    $_.Path -and $_.CommandLine -like "*bulu-browser*"
} | ForEach-Object { try { $_.Kill() } catch {} }

if (Test-Path $skillDir) {
    Remove-Item $skillDir -Recurse -Force
    Write-Host "已删除技能目录"
}

if (Test-Path $mcpFile) {
    Copy-Item $mcpFile "$mcpFile.bak" -Force
    try {
        $config = (Get-Content $mcpFile -Raw -Encoding UTF8) | ConvertFrom-Json
        if ($config.mcpServers -and ($config.mcpServers.PSObject.Properties.Name -contains "bulu-browser")) {
            $config.mcpServers.PSObject.Properties.Remove("bulu-browser")
            $json = $config | ConvertTo-Json -Depth 20
            [System.IO.File]::WriteAllText($mcpFile, $json, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "已从 mcp.json 移除 bulu-browser"
        }
    } catch {
        Write-Host "mcp.json 解析失败，请手动删除 bulu-browser 条目" -ForegroundColor Yellow
    }
}

$keepProfile = Read-Host "是否保留浏览器数据（登录态）？输入 y 保留，其他键删除"
if ($keepProfile -ne "y") {
    if (Test-Path $appBase) {
        Remove-Item $appBase -Recurse -Force
        Write-Host "已删除程序与浏览器数据"
    }
} else {
    $appDir = Join-Path $appBase "app"
    if (Test-Path $appDir) { Remove-Item $appDir -Recurse -Force }
    Write-Host "已删除程序，保留 $appBase\profile 中的登录态"
}

Write-Host ""
Write-Host "卸载完成。重启 WorkBuddy 生效。" -ForegroundColor Green
