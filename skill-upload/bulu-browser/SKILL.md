---
name: bulu-browser
display_name: "布噜浏览器"
display_name_en: "Bulu Browser"
description: "用本机真实 Chrome 打开、阅读和操作网页，支持点击、输入、截图、抓接口。"
description_zh: "用本机真实 Chrome 打开网页、读取页面结构与可交互元素、点击输入、整页截图、抓取网络请求和 console 日志。登录态保存在独立 profile，重启后依然有效。适合需要真实渲染、页面交互或登录态的场景。"
description_en: "Drive a real Chrome on the user's machine: open pages, read structured snapshots with clickable refs, click, type, screenshot, inspect network requests and console logs. Login state persists in an isolated profile."
examples_zh:
  - "打开 example.com，把这个页面的主要内容读给我"
  - "在这个网页的搜索框里填上关键词并提交，然后告诉我结果"
  - "看看这个页面调用了哪些接口，把最新那条请求的返回结构给我"
examples_en:
  - "Open example.com and summarize the main content"
  - "Fill the search box on this page with a keyword, submit, and tell me the results"
  - "List the API requests this page made and show the latest response body"
version: 1.1.0
author: Jevin0201
allowed-tools: Bash
---

# 布噜浏览器（Bulu Browser）

通过本机真实 Chrome（Chrome / Edge / Brave 自动发现）执行网页操作，而不是只抓 HTML 文本。
它会**真的打开浏览器窗口**：执行页面 JS、保留 Cookie 登录态、点击按钮、填写表单。
首次运行会通过 `npx` 自动下载运行包（约 100 KB，需已安装 Node.js ≥ 20 与 npm），之后秒级启动。

## 使用前检查

首次调用前先运行一次环境自检：

```bash
node -v && npm -v
```

- 若 `node` 不存在或版本 < 20：告知用户需要先安装 Node.js（https://nodejs.org 下载 LTS 版），**不要**自行尝试安装。
- 检查通过即可直接使用，无需任何其他安装步骤。

## 基本约定

- 所有命令通过 Bash 执行，统一格式：`npx -y bulu-browser-mcp cli <命令> [参数]`
- 所有输出都是 JSON，直接解析使用；出错时返回 `{"ok": false, "error": "..."}`
- 命令之间浏览器保持运行：登录态、Cookie、已开的标签页都还在
- `snapshot` 返回的 `refs` 里行首编号（如 `5:12`）是元素引用，把它传给 `act` 即可操作
- **操作或跳转后 ref 会失效**，需要重新 `snapshot` 再拿新的

## 命令清单

```bash
# 打开网页（自动补 https；不像网址的文本会当作搜索词）
npx -y bulu-browser-mcp cli open <url> [--new-tab]

# 读取当前页：text = 可见文本，refs = 可交互元素清单（一行一个，行首是 ref）
npx -y bulu-browser-mcp cli snapshot [--max-text 3000] [--max-refs 80] [--selector <css>]

# 操作元素（interaction: click / double_click / type / select / check / hover / focus / scroll_into_view）
npx -y bulu-browser-mcp cli act --ref 5:12 --interaction click
npx -y bulu-browser-mcp cli act --ref 5:8 --interaction type --text "关键词"
npx -y bulu-browser-mcp cli act --ref 5:20 --interaction click --on-dialog accept   # 有确认框时

# 整页截图，返回保存路径（PNG）
npx -y bulu-browser-mcp cli screenshot --out /tmp/page.png

# 页面 HTML（默认截断 10 万字符，可用 --max-chars 调整）
npx -y bulu-browser-mcp cli content --max-chars 50000

# 网络请求 / 响应体 / console 日志（打开页面后自动记录）
npx -y bulu-browser-mcp cli network --filter api --limit 30
npx -y bulu-browser-mcp cli network-body "https://api.example.com/xxx"
npx -y bulu-browser-mcp cli console --limit 50

# 标签页管理
npx -y bulu-browser-mcp cli tabs
npx -y bulu-browser-mcp cli select-tab <tabId>
npx -y bulu-browser-mcp cli close-tab <tabId>

# 发送按键（Space / Enter / Escape / ArrowDown ...）
npx -y bulu-browser-mcp cli key Enter

# 关闭整个浏览器（登录态保留在磁盘，下次打开仍有效）
npx -y bulu-browser-mcp cli quit
```

## 标准工作流

1. `open <url>` 打开页面
2. `snapshot --max-refs 80 --max-text 3000` 读结构与元素；页面很长时用返回的 `nextTextOffset` / `nextRefOffset` 继续读
3. 需要操作时 `act --ref <ref> --interaction <类型>`，操作完**必须重新 snapshot** 拿新 ref
4. 需要看视觉效果时 `screenshot`，用返回的 `path` 查看图片
5. 结束后不主动 `quit`，保留浏览器供后续使用（用户要求关闭时才执行）

## 注意事项

- 点击/输入前确认 ref 来自**最新**的 snapshot；报"ref 已失效"就重新 snapshot
- `type` 会先清空再输入；追加输入用 `focus` 后 `key` 逐字发送
- 弹出 alert/confirm 默认自动 dismiss；需要点"确定"的确认框加 `--on-dialog accept`
- 登录类操作让用户自己在打开的浏览器窗口里完成，登录态会持久保存
- 不要把用户未同意的页面内容或 cookie 发送到外部
