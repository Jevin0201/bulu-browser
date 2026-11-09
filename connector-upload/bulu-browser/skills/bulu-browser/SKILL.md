---
name: bulu-browser-skill
description: 通过本机真实 Chrome 浏览器访问和操作网页：打开页面、读取页面结构与可交互元素、点击输入、整页截图、抓取网络请求与 console 日志。适用于需要真实渲染、登录态或页面交互的场景。
version: 1.0.1
author: Jevin0201
---

# 布噜浏览器（Bulu Browser）

用本机真实 Chromium 内核浏览器（Chrome / Edge / Brave）执行网页操作，而不是只抓取 HTML 文本。
它**真的会打开浏览器窗口**：执行页面 JavaScript、保留 Cookie 登录态、点击按钮、填写表单，
看到的是渲染后的真实结果。

## 何时使用

适合：

- 用户给出网址，要求"打开看看 / 读一下这个页面 / 总结这个网页"
- 需要在页面里操作：搜索、填表单、点击、翻页、勾选
- 页面依赖 JavaScript 渲染，或用 WebFetch 只能拿到空壳 HTML
- 需要登录后才能看的内容（由用户在浏览器窗口里自行登录）
- 需要截图取证，或需要看页面调用了哪些接口、报了什么 JS 错误

不适合：

- 只是要搜索资料、找链接 → 用搜索类工具，拿到链接后再用本连接器打开
- 纯文本抓取且无需渲染、用户要求"不要开浏览器/快一点" → 用轻量抓取方式
- 用户明确指定使用其他浏览器工具

## 前置条件

- 本机需已安装 **Google Chrome / Microsoft Edge / Brave** 之一。
  启动时会自动在 Windows、macOS、Linux 的常见安装路径中查找。
  如需指定浏览器，可设置环境变量 `BULU_CHROME_PATH` 指向浏览器可执行文件。
- 首次调用会启动一个**独立 profile** 的浏览器窗口，其登录态与用户日常浏览器隔离，
  不会读取用户已有 Cookie。窗口会在后续调用中复用。
- 运行环境需要 Node.js 18+（连接器已声明运行时，通常无需手动安装）。

## 工具清单

| 工具 | 用途 |
|---|---|
| `browser_open` | 打开网址或搜索词，返回 tabId 与标签列表 |
| `browser_snapshot` | 读取页面：可见文本 + 可交互元素引用（ref） |
| `browser_act` | 对 ref 或 CSS 选择器执行 click / type / select / check 等操作 |
| `browser_batch` | 一次调用执行多步操作，批量填表用 |
| `browser_press_key` | 发送键盘按键（Enter、Escape、Control+A…） |
| `browser_screenshot` | 截图并返回本地 PNG 路径 |
| `browser_tabs` | 列出全部标签页 |
| `browser_select_tab` | 切换当前标签页 |
| `browser_close_tab` | 关闭指定标签页 |
| `browser_request` | 在页面上下文中发起 HTTP 请求（自动携带页面 Cookie） |
| `browser_network` | 查看页面最近发出的网络请求，可读取响应体 |
| `browser_console` | 读取 console 输出与 JS 异常 |
| `browser_get_content` | 导出页面正文（text）或源码（html） |
| `browser_downloads` | 列出本次会话触发的下载文件 |
| `browser_close` | 关闭浏览器实例 |

## 核心工作流

```
1. browser_open     { url }
2. browser_snapshot { maxRefs: 120 }
3. 在 refs 中定位目标元素（看 label / text / placeholder）
4. browser_act      { ref: "5:12", interaction: "type", text: "关键词" }
5. browser_press_key{ key: "Enter" }
6. 重新 browser_snapshot 确认结果
```

### ref 规则（重要）

- `browser_snapshot` 返回的 `refs` 是紧凑文本，一行一个元素，行首即 ref：

  ```
  5:1  a role=button "跳至内容"
  5:4  input type=search label="搜索" val="workbuddy"
  5:7  button type=submit label="搜索"
  ```

- 把行首的 `5:7` 直接传给 `browser_act` 的 `ref`。`5` 是页面版本号，`7` 是元素序号。
- **任何操作后 ref 均会失效**（页面跳转、DOM 变化都会重新分配），必须重新 snapshot 再操作。
- 连续读取同一页面、只想多看几个字段时，传 `preserveRefs: true` 保留已有 ref。
- 需要完整字段（role / type / 状态）时传 `detailed: true`，返回结构化数组。
- 页面很长时返回 `complete: false`，用 `textOffset` / `nextRefOffset` 继续分页读取；
  只取正文时传 `maxRefs: 0` 可显著提速。

### 批量操作

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

- steps 中的 ref 必须来自同一次 snapshot，只适合"不改变页面结构"的连续动作（最多 25 步）。
- 会触发跳转或弹层的操作放在最后一步，或改用多次 `browser_act`。
- 中途失败会立即停止，并报告停在哪一步、错误原因。

### 操作后验证

用 `expect` 一次完成"操作 + 校验"，避免多余快照：

```
browser_act { ref: "5:12", interaction: "click", expect: { url: "/success" } }
```

支持 `url` / `text` / `selector` / `value` 四种条件，等待上限由 `expectTimeoutMs` 控制（默认 8000ms）。

### 弹窗处理

alert / confirm / prompt 默认**取消**。需要确认提交时，在触发它的那一步传 `onDialog: "accept"`；
prompt 需填写内容时再传 `dialogText`。

## 常见任务配方

**读取页面内容**
```
browser_open     { url: "https://example.com" }
browser_snapshot { maxTextChars: 8000, maxRefs: 0 }
```

**搜索并读取结果**
```
browser_open      { url: "https://www.bing.com" }
browser_snapshot  {}                                  → 定位输入框
browser_act       { ref, interaction: "type", text: "关键词" }
browser_press_key { key: "Enter" }
browser_snapshot  { maxTextChars: 8000 }               → 读结果
```

**登录后内容**
打开登录页，让用户在**弹出的浏览器窗口里自行登录**（扫码或手动输入）。
登录态会保存在独立 profile 中，后续调用自动复用。
**不要向用户索要账号密码**，也不要尝试读取用户日常浏览器的 Cookie。

**分析接口**
```
browser_open    { url }
browser_network { action: "list", filter: "/api/" }
browser_network { action: "body", url: "..." }
```

**截图取证**
`browser_screenshot { fullPage: true }` 返回本地 PNG 绝对路径。

## 注意事项

- **不要主动调用 `browser_close`**，除非用户明确要求关闭浏览器。关闭会丢失当前标签页，
  再次使用需重新冷启动。
- 涉及金额、地址、删除、提交发布类操作，执行前先把将要填写/提交的内容复述给用户确认。
- 下载文件保存在系统临时目录下的 `bulu-browser/downloads`，用 `browser_downloads` 查询。
- 截图保存在系统临时目录下的 `bulu-browser/shots`。
- 本连接器仅做浏览器自动化，不提供验证码破解、反爬绕过等能力；遇到验证码交由用户人工完成。
- 仅访问用户明确要求访问的站点。

## 故障排查

| 现象 | 处理 |
|---|---|
| 提示"未找到 Chrome / Edge / Brave" | 安装任一 Chromium 内核浏览器，或设置 `BULU_CHROME_PATH` |
| 提示"ref 已失效" | 重新调用 `browser_snapshot`，不要复用旧 ref |
| 浏览器启动后立即退出 | 同一 profile 已被其他窗口占用，关闭后重试 |
| 点击无反应 | 检查返回结果中的 `dialog` 字段，页面可能被弹窗遮挡 |
| 页面空白或一直加载 | 等 2–3 秒再 snapshot，或用 `browser_console` 查看 JS 错误 |
| 登录态丢失 | 独立 profile 目录被清理，重新登录一次即可 |
