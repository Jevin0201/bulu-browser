$ErrorActionPreference = "Stop"

$appDir = Join-Path $env:LOCALAPPDATA "bulu-browser\app"
$entry = Join-Path $appDir "src\index.mjs"

if (-not (Test-Path $entry)) {
    Write-Host "请先运行 install.ps1" -ForegroundColor Red
    exit 1
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Write-Host "找不到 node" -ForegroundColor Red
    exit 1
}

$chrome = @(
    (Join-Path $env:PROGRAMFILES "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:PROGRAMFILES(X86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:PROGRAMFILES "Microsoft\Edge\Application\msedge.exe")
) | Where-Object { Test-Path $_ } | Select-Object -First 1

$desktop = [Environment]::GetFolderPath("Desktop")
$link = Join-Path $desktop "WorkBuddy 浏览器.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($link)
$shortcut.TargetPath = $node
$shortcut.Arguments = "`"$entry`" --open"
$shortcut.WorkingDirectory = $appDir
$shortcut.Description = "WorkBuddy 专属浏览器（独立 profile，保留登录态与书签）"

$ico = Join-Path $appDir "assets\icons\bulu-browser.ico"
if (Test-Path $ico) {
    $shortcut.IconLocation = "$ico,0"
} elseif ($chrome) {
    $shortcut.IconLocation = "$chrome,0"
}
$shortcut.WindowStyle = 7
$shortcut.Save()

Write-Host ""
Write-Host "已在桌面创建快捷方式: WorkBuddy 浏览器" -ForegroundColor Green
Write-Host "双击它会启动（或唤醒）这个专属浏览器。"
Write-Host "浏览器数据目录: $(Join-Path $env:LOCALAPPDATA 'bulu-browser\profile')"
