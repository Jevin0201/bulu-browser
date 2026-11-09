# 布噜浏览器专家

把 buLu（布噜换芯）的浏览器控制能力抽出来，做成 WorkBuddy 可用的技能 + MCP 工具包。

装完之后，你可以直接说「打开这个网页看看」「帮我填这个表单」「把这个页面的内容抓下来」，
WorkBuddy 会真的打开一个 Chrome 去操作，而不是只抓 HTML 文本。

## 作为公共 MCP 使用（任意客户端，无需克隆仓库）

包已发布到 npm，并注册到官方 MCP Registry（`io.github.jevin0201/bulu-browser`）。
要求：Node.js ≥ 20，本机装有 Chrome / Edge / Brave 之一。

在任意支持 stdio MCP 的客户端（Claude Code、Claude Desktop、Cursor、WorkBuddy 等）配置：

```json
{
  "mcpServers": {
    "bulu-browser": {
      "command": "npx",
      "args": ["-y", "bulu-browser-mcp"]
    }
  }
}
```

可选环境变量：

| 变量 | 作用 |
| --- | --- |
| `BULU_CHROME_PATH` | 指定浏览器可执行文件路径 |
| `BULU_PROFILE_DIR` | 自定义浏览器 profile 目录（登录态保存在这里） |
| `BULU_CDP_URL` | 复用已有 Chrome 的 CDP 地址（如 `http://127.0.0.1:9222`），不自带启动 |
| `BULU_ALLOWED_HOSTS` | 逗号分隔的域名白名单，设置后只允许访问这些站点 |

Windows 用户也可以直接克隆本仓库运行 `install.ps1`，获得 WorkBuddy 深度集成（技能 + 连接器 + 桌面快捷方式）。

## 项目结构

```
bulu-browser/
├── install.ps1              一键安装（复制程序 + 注册 MCP + 自检）
├── uninstall.ps1            卸载（可选保留浏览器数据）
├── create-shortcut.ps1      在桌面创建「WorkBuddy 浏览器」快捷方式
├── package.json
├── src/                     ── 核心程序，4 个文件共 42KB
│   ├── index.mjs              MCP server（stdio JSON-RPC，15 个工具）
│   ├── driver.mjs             浏览器驾驶层（会话、标签、动作、网络）
│   ├── snapshot.mjs           页面快照与 ref 机制
│   └── chrome.mjs             Chrome 启动、CDP 探测、锁清理、端口复用
├── skill/SKILL.md           技能说明（教模型什么时候用、怎么用）
├── connector-plugin/        ── 带图标的连接器插件包（见「启用步骤 · 方式 A」）
│   ├── install.mjs             注册到本地连接器市场 / --uninstall 回滚
│   └── connectors/bulu-browser/ai.workbuddy/assets/icon.png   ← 连接器图标
├── assets/
│   ├── icons/
│   │   ├── bulu-browser.ico      多尺寸图标（16~256 共 7 档，54KB）
│   │   └── icon-16…512.png       各尺寸 PNG
│   ├── bulu-browser-icon-1024.png   主图标（白底圆角）
│   ├── bulu-browser-transparent-1024.png  透明底版
│   ├── showcase.png          图标效果总览
│   ├── bulu-mascot-upper.png 布噜半身素材（图标用）
│   ├── icon-preview.html     图标源文件（改设计从这里改）
│   └── showcase.html
├── node_modules/playwright-core/   唯一运行时依赖（12MB）
└── dev/                      开发辅助脚本（生成图标、跑测试）
```

## 它和普通网页抓取的区别

| | WebFetch | 本工具 |
|---|---|---|
| 真实浏览器渲染 | 否 | 是（真 Chrome） |
| 保留登录态 | 否 | 是（持久 profile） |
| 能点击/填表 | 否 | 是 |
| 能截图 | 否 | 是 |
| 能看接口请求 | 否 | 是 |

## 安装了哪些东西

```
%LOCALAPPDATA%\bulu-browser\
├── app\                    ← 程序本体（12MB，含 playwright-core）
│   ├── src\index.mjs       ← MCP server
│   ├── src\driver.mjs      ← 浏览器驾驶层
│   ├── src\snapshot.mjs    ← 页面快照 + ref 机制
│   └── src\chrome.mjs      ← Chrome 启动与 CDP 探测
└── profile\                ← 浏览器数据（登录态存在这里）

%USERPROFILE%\.workbuddy\
├── skills\bulu-browser\SKILL.md   ← 技能说明（教模型怎么用）
├── mcp.json                        ← 方式 B：裸 MCP 注册
└── plugins\marketplaces\bulu-local\  ← 方式 A：带图标的连接器插件包（本机当前用这个）
```

两种方式只会启用一种；方式 A 注册时会备份并移除 `mcp.json` 里的同名条目，
备份文件为 `mcp.json.bak-bulu`，`--uninstall` 会还原。

## 启用步骤

有**两种接入方式**，二选一（不要同时用，会注册出两个同名连接器）。

### 方式 A：带图标的连接器插件（推荐，本机已启用）

WorkBuddy 的 `mcp.json` 自定义 MCP 通道**不支持图标字段**，所以裸配置在连接器列表里
只能显示通用占位图。带图标的连接器走的是插件包格式：图标按约定路径
`ai.workbuddy/assets/icon.png` 自动读取，不需要在 JSON 里声明。

`connector-plugin/` 就是一个标准的连接器插件包：

```
connector-plugin/
├── .codebuddy-plugin/marketplace.json       本地市场索引
├── connectors/bulu-browser/
│   ├── .codebuddy-plugin/plugin.json        中文名「布噜浏览器」+ 示例指令
│   ├── mcp.json                             stdio 服务定义
│   ├── ai.workbuddy/assets/icon.png         512×512 ← 图标在这里
│   └── skills/bulu-browser/SKILL.md
└── install.mjs                              注册 / 回滚
```

注册与回滚（脚本会先备份索引和 `mcp.json`）：

```powershell
node "D:\network shared\bulu-browser\connector-plugin\install.mjs"               # 注册
node "D:\network shared\bulu-browser\connector-plugin\install.mjs" --uninstall  # 回滚
```

注册时会自动移除 `mcp.json` 里的裸配置，避免重名；回滚时恢复。
改完后**完全退出并重启 WorkBuddy** → 「专家·技能·连接器」→「连接器」→
找到「布噜浏览器」→ 安装 / 信任。状态灯变绿即生效。

> 如果重启后市场里找不到它（部分版本只校验服务端下发的市场索引），跑 `--uninstall`
> 回滚，会自动恢复成下面的方式 B（裸 MCP 配置），工具不会丢，只是没有图标。

### 方式 B：裸 MCP 配置（最通用，无图标）

`install.ps1` 会把 `bulu-browser` 注册进 `~/.workbuddy/mcp.json`。重启 WorkBuddy →
「连接器」→ 右上角「自定义连接器」→「MCP 服务管理」→ 点「信任」。
配置写好后不点信任、不重启都不会加载。

两种方式最终暴露的工具名一致：`mcp__bulu-browser__browser_*`。之后正常说话即可。

## 它是怎么工作的

和 buLu 桌面端同款方案，只是去掉了 UI 层：

```
WorkBuddy ──stdio JSON-RPC──> index.mjs
                                │
                                ├─ 启动真实 Chrome：--remote-debugging-port + 独立 --user-data-dir
                                ├─ playwright-core connectOverCDP 接管
                                └─ 给可交互元素打 data-bulu-ref 标记

模型看到：页面文本 + refs 列表（ref / tag / label / placeholder / value / checked）
模型操作：browser_act { ref: "5:12", interaction: "type", text: "..." }
```

关键设计：

- **ref 带版本号**（`5:12` 里的 5 是页面 epoch）。页面一变化就失效，逼着模型重新快照，
  避免拿着陈旧元素引用乱点。
- **操作后自动 diff**：返回 url / title / 文本 / 控件数是否变化，模型能判断操作到底生效没有。
- **输入后校验**：填完读回 value，写不进去直接报错，不会静默失败。
- **代理隔离**：启动时清掉 `HTTP_PROXY` 并补 `NO_PROXY`，否则 Playwright 的 WebSocket
  升级会被企业代理拦成 404（这是实测踩到的坑）。

## 15 个工具

`browser_open` `browser_snapshot` `browser_act` `browser_batch` `browser_press_key`
`browser_screenshot` `browser_tabs` `browser_select_tab` `browser_close_tab` `browser_request`
`browser_network` `browser_console` `browser_downloads` `browser_get_content` `browser_close`

三个关键能力：

- **`browser_batch`** —— 一次调用执行多步（填表单从 20 次往返降到 1 次）
- **`expect` 参数** —— 操作后由服务端直接验证 url/text/selector，省掉一次确认快照
- **紧凑 ref 格式** —— 元素清单按行输出，实测比 JSON 体积小 42%

## 环境变量

| 变量 | 作用 |
|---|---|
| `BULU_CHROME_PATH` | 指定浏览器可执行文件 |
| `BULU_PROFILE_DIR` | 指定 profile 目录（默认 `%LOCALAPPDATA%\bulu-browser\profile`） |
| `BULU_CDP_URL` | 复用已有 Chrome 的调试端口，如 `http://127.0.0.1:9222` |
| `BULU_ALLOWED_HOSTS` | 域名白名单，逗号分隔（如 `example.com,corp.internal`）。设置后只允许访问这些域名，用于防注入 |

## 登录态、书签与数据持久化

profile 是独立的、持久的，存在 `%LOCALAPPDATA%\bulu-browser\profile`。所有数据都在里面：

- 各站点的登录态（cookie、localStorage）
- 书签
- 浏览器扩展（如果装了）
- 历史记录、密码

**关闭再启动，用的还是这一个浏览器。** 四种情况都验证过：

| 场景 | 结果 |
|---|---|
| 调 `browser_close` 正常关闭 → 再启动 | cookie / localStorage 全部保留 |
| WorkBuddy 结束会话、MCP 进程被终止 → 再启动 | Chrome 独立存活，下次直接复用同一个实例，数据都在 |
| 你手动点 Chrome 窗口的 ✕ → 再启动 | 正常关闭，数据保留 |
| **重启电脑 → 再启动** | 旧的调试端口失效会自动重新拉起；profile 残留锁会被清理并重试，不会卡死 |

实现上有三个关键点，缺一个都会出问题：

1. **启动时 `detached + unref`** —— 让 Chrome 独立于 MCP 进程。否则 WorkBuddy 杀掉 MCP 进程时会把 Chrome 一起带走，来不及落盘。
2. **关闭时走 CDP `Browser.close`** —— 让 Chrome 自己正常退出并保存数据，等它退出（最多 6 秒）才兜底强杀。早期版本直接 `taskkill /F`，实测 cookie 和 localStorage 会双双丢失。
3. **启动失败自动清锁重试** —— 非正常关机后 Chrome 可能在 profile 里留下 `SingletonLock` 等锁文件，导致下次起不来。现在第一次失败会清锁再试一次，超时也从 20 秒放宽到 45 秒（应付刚开机时的冷启动）。

⚠️ 唯一的例外：**断电或任务管理器强杀**时 Chrome 来不及把 cookie 刷到磁盘，最近几秒内的登录可能丢失。这是 Chrome 自身机制，正常重启不会触发。

第一次遇到要登录的网站，Chrome 窗口会弹出来，你在里面登录一次即可，之后一直有效。
**不要向模型提供账号密码**，让它停在登录页，你自己完成。

想彻底清空的话，删掉 `%LOCALAPPDATA%\bulu-browser\profile` 目录即可。

## 随时打开这个专属浏览器

桌面上的「WorkBuddy 浏览器」快捷方式，双击即可打开（或唤醒）这个浏览器，
不需要开始对话。它和技能用的是**同一个 profile**，登录态、书签都共享。

命令行等价操作：

```powershell
# 打开浏览器（可选带网址）
node "$env:LOCALAPPDATA\bulu-browser\app\src\index.mjs" --open https://www.bing.com

# 查看它是否正在运行
node "$env:LOCALAPPDATA\bulu-browser\app\src\index.mjs" --status
```

如果你删了快捷方式，重新生成：

```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\bulu-browser\app\create-shortcut.ps1"
```

这个浏览器和你日常用的 Chrome 是**两个独立实例**：独立的用户数据目录，书签和登录态不互通。
这样自动化操作不会污染你的日常浏览记录，也不会误用你的账号。

## 手动排查

```powershell
# 自检：启动一次浏览器并访问 example.com
node "$env:LOCALAPPDATA\bulu-browser\app\src\index.mjs" --check

# 指定浏览器
$env:BULU_CHROME_PATH = "D:\Chrome\chrome.exe"

# 指定 profile 目录
$env:BULU_PROFILE_DIR = "D:\my-profile"
```

## 图标

Chrome 官方几何（红/绿/黄三扇各 120°、白环、蓝心）+ 右下角布噜角标。
布噜取自源码包 `packages/app/src/assets/bulu/bulu-mascot-front.png`（全身像），
裁出上半身，底部用渐变淡出避免生硬切断。

| 文件 | 用途 |
|---|---|
| `assets/icons/bulu-browser.ico` | Windows 快捷方式图标，含 16/24/32/48/64/128/256 七档 |
| `assets/icons/icon-*.png` | 各尺寸单文件 |
| `assets/bulu-browser-icon-1024.png` | 主图标源图（白底圆角） |
| `assets/bulu-browser-transparent-1024.png` | 透明底版，适合深色背景 |
| `assets/icon-preview.html` | 图标源文件，改设计从这里改 CSS |

改了图标之后重新生成并同步：

```powershell
node dev/render-final.mjs      # 输出两张 1024 主图
node dev/export-icons.mjs      # 输出全套 PNG + 打包 ico
powershell -ExecutionPolicy Bypass -File .\install.ps1         # 同步到 AppData
powershell -ExecutionPolicy Bypass -File .\create-shortcut.ps1 # 刷新快捷方式图标
```

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
```

会删掉技能目录、从 mcp.json 移除条目，并询问是否保留浏览器数据。

## 已知限制

- 需要本机装有 Chrome / Edge / Brave 之一（不自带浏览器内核，省 150MB+）
- snapshot 仍基于 DOM 扫描，未改用 Playwright 的 `ariaSnapshot()`；复杂 SPA 上 ref 稳定性还有提升空间
- 多个会话共用同一个 profile 时会接管同一个 Chrome 实例，标签页会互相影响；需要隔离请给不同会话设不同的 `BULU_PROFILE_DIR`
- `browser_network` 的 body 是重新发一次请求取的，和原始请求的 header 可能不完全一致
- 下载文件统一存到 `%TEMP%\bulu-browser\downloads`，会话结束后不会自动清理
