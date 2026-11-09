---
name: bulu-browser
description: >-
  【本机默认浏览器通道】用独立真实 Chrome 打开和操作网页（打开、读取、点击、
  输入、截图、抓接口），工具名以 mcp__bulu-browser__browser_ 开头。
  只要任务涉及访问某个网址——用户说"打开这个网页看看""帮我看看某网站""搜一下
  某站""填这个表单""点一下""截个图""看看页面调了什么接口"，或任何需要浏览器
  渲染/登录态的场景——一律优先加载本技能并使用本 MCP，不要改用 WebFetch、
  内置浏览器控制（workbuddy-browser-use / agent-browser）或其他 Playwright 方案。
  仅当用户明确说"别开浏览器/只要文本/快一点"时才用 WebFetch。
  能力来自 buLu 的 CDP + Playwright 方案，登录态保存在专属 profile。
---

# 布噜浏览器专家

用真实 Chrome 操作网页，而不是 `WebFetch` 那种拿 HTML 文本的方式。区别在于：
这个能力会**真的打开浏览器**，能执行 JS、保留 Cookie 登录态、点按钮、填表单、
看到渲染后的结果。

## 什么时候该用（默认优先）

**默认一律用本技能**：凡是需要"打开某个网址 / 看某个页面 / 在网页里操作"，
即使只是要读一段文字、看起来 `WebFetch` 也能做，也先 `browser_open`。
原因：本机要的是同一个浏览器实例和它的登录态；`WebFetch` 常常拿到未登录、
未执行 JS 的空壳页面，还得重来一遍。

不要用的情况只有三种：

- 用户明确说"别开浏览器 / 只要文本 / 快一点" → 用 `WebFetch`
- 只是用搜索引擎找资料、找链接 → 用 `WebSearch`（拿到链接后再用本技能打开）
- 用户明确指定要用别的浏览器工具

**不要主动切到内置浏览器控制**（`workbuddy-browser-use` / `agent-browser`）：
它们用的是另一套 profile，登录态、书签和布噜浏览器不共享。

## 工具清单

| 工具 | 用途 |
|---|---|
| `browser_open` | 打开网址，返回 tabId |
| `browser_snapshot` | **读页面**：可见文本 + 可交互元素清单（ref） |
| `browser_act` | 对 ref 或选择器执行 click / type / select / check / hover，可带 `expect` 直接验证结果 |
| `browser_batch` | **一次调用执行多步**，填表单必备 |
| `browser_press_key` | 发按键（Enter、Escape、Control+A…） |
| `browser_screenshot` | 整页截图，返回 PNG 路径 |
| `browser_tabs` / `browser_select_tab` / `browser_close_tab` | 标签管理 |
| `browser_request` | 在页面上下文发请求，自动带 Cookie |
| `browser_network` | 逆向抓包：list 看请求（`verbose: true` 带请求头和 POST body），body 取真实响应（优先抓包缓存，非重放） |
| `browser_console` | 读 console 和 JS 报错 |
| `browser_downloads` | 列出本会话触发的下载文件 |
| `browser_get_content` | 导出全文（text）或源码（html） |
| `browser_close` | 关闭浏览器 |

## 标准工作流

```
1. browser_open { url }
2. browser_snapshot { maxRefs: 120 }
3. 从 refs 里找到目标元素，看 label / text / placeholder 判断
4. browser_act { ref: "5:12", interaction: "type", text: "关键词" }
5. browser_press_key { key: "Enter" }
6. 重新 browser_snapshot 确认结果
```

**核心规则：每次操作后 ref 都会失效。** 只要调用过 `browser_act` / `browser_press_key`
或页面自己发生了变化，就必须重新 `browser_snapshot` 才能拿到可用的 ref。拿旧 ref
去操作会报"ref 已失效"。

## ref 怎么读

`browser_snapshot` 的 `refs` 是**紧凑文本**，一行一个元素，行首就是 ref：

```
5:1  a role=button "跳至内容"
5:4  input type=search label="在此处输入你的搜索" val="workbuddy"
5:7  button type=submit label="搜索"
5:9  a "帮助" disabled
```

字段含义：`label=` 可访问标签 · `ph=` placeholder · `val=` 当前值 · `checked/selected/expanded` 状态 ·
`disabled` 不可用。

- 把行首的 `5:7` 直接传给 `browser_act` 的 `ref` 即可。
- `5` 是页面版本号（epoch），`7` 是元素序号。页面跳转后版本号会变。
- 需要完整字段（比如要判断 role/type）时传 `detailed: true`，会返回 JSON 数组。
- **每次 snapshot 都会重新分配 ref，即使页面没变。** 所以连续读两次的话，
  第二次会作废第一次的 ref；如果只是想多看几个字段，用 `preserveRefs: true`。

## 批量操作与结果验证

填表单**不要一步一步来**，用 `browser_batch` 一次做完：

```
browser_batch {
  steps: [
    { ref: "5:4", interaction: "type",   text: "张三" },
    { ref: "5:6", interaction: "type",   text: "13800000000" },
    { ref: "5:8", interaction: "select", option: "北京市" },
    { ref: "5:9", interaction: "check" }
  ]
}
```

- steps 里的 ref 都来自**同一次 snapshot**，所以只适合"不改变页面结构"的连续动作。
- 会触发跳转或弹层的按钮放最后一步，或者干脆改用 `browser_act`。
- 中途失败会立即停止，返回停在第几步、什么错误。

操作后想确认结果，用 `expect`，**不要再 snapshot 一次**：

```
browser_act {
  ref: "5:12", interaction: "click",
  expect: { url: "/success" }
}
```

`expect` 支持 `url` / `text` / `selector` / `value` 四种条件，服务端等到满足才返回，
不满足就报超时。这样一次调用就完成了"操作 + 验证"。

## 弹窗（alert / confirm / prompt）

默认自动**取消**。遇到"确认提交吗？"这种需要点确定的对话框，在触发它的那一步传
`onDialog: "accept"`：

```
browser_act { ref: "5:14", interaction: "click", onDialog: "accept" }
```

prompt 类型还要填内容时，再加 `dialogText: "要输入的文字"`。

## 长页面分页

`browser_snapshot` 返回的 `snapshot` 字段：

```json
{ "complete": false, "nextTextOffset": 12000, "nextRefOffset": 120 }
```

`complete: false` 表示没读完，用 `textOffset` / `refOffset` 继续读。
只想收集正文时传 `maxRefs: 0`（跳过控件扫描，快很多）。

## 常见任务配方

**搜索并取结果**
```
browser_open { url: "https://www.bing.com" }
browser_snapshot {}                        → 找 textarea
browser_act { ref, interaction: "type", text: "问题关键词" }
browser_press_key { key: "Enter" }
browser_snapshot { maxTextChars: 8000 }     → 读结果
```

**抓登录后才能看的内容**
浏览器用的是独立 profile（`%LOCALAPPDATA%\bulu-browser\profile`），第一次需要登录时，
打开登录页让用户自己扫码/输密码，登录态会保存在这个 profile 里，之后一直有效。
不要向用户索要账号密码，让他在弹出的 Chrome 窗口里自己完成。

**不要主动调用 `browser_close`**，除非用户明确说"关掉浏览器"。关掉会让用户下次等多一次冷启动，
登录态虽然会保留，但当前会话的标签页都消失了。任务结束就让它开着，下次自动复用同一个实例。

**填表单**
按顺序 `act` 每个输入框 → 勾选协议 → `act` 提交按钮 → `snapshot` 验证结果文案。
提交前把要填的内容复述给用户确认，尤其是涉及金额、地址、删除类操作。

**分析页面接口**
```
browser_open { url }
browser_snapshot {}                          → 触发页面加载
browser_network { action: "list", filter: "/api/" }
browser_network { action: "body", url: "..." }
```

**取证截图**
`browser_screenshot {}` 返回本地 PNG 路径，需要查看就用 `Read` 读那个路径。

## 故障排查

| 现象 | 处理 |
|---|---|
| 报"未找到 Chrome" | 让用户装 Chrome，或设 `BULU_CHROME_PATH` 指向浏览器 exe |
| 报"ref 已失效" | 重新 `browser_snapshot`，不要复用旧 ref |
| 报"Chrome 以 code 0 立即退出" | 有别的 Chrome 窗口占着同一个 profile，关掉它再试 |
| 报"域名不在允许列表" | 设了 `BULU_ALLOWED_HOSTS`，当前站点不在名单里；需要用户确认 |
| 点了没反应 | 检查返回里的 `dialog` 字段，可能被弹窗挡住了 |
| 页面空白/一直转圈 | 等 2-3 秒再 snapshot；或 `browser_console` 看 JS 报错 |
| 连不上 CDP | 本工具启动时会自动清理 `HTTP_PROXY` 并设 `NO_PROXY`，若仍失败查企业代理策略 |
| 登录态丢失 | profile 目录被删了，重新登录一次即可 |

## 底层实现（用户问起时再展开）

启动真实 Chrome（`--remote-debugging-port` + 独立 `--user-data-dir`）→ 用
`playwright-core` 的 `connectOverCDP` 接管 → 给可交互元素打 `data-bulu-ref` 标记 →
模型用 ref 定位操作。与 buLu 桌面端同款方案，去掉了 UI 层。
源码在 `%LOCALAPPDATA%\bulu-browser\app`。
