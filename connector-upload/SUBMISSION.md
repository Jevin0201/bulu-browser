# bulu-browser 连接器 · 上架申请材料

> 生成时间：2026-11-09 ｜ 目标平台：WorkBuddy 开放平台（open.workbuddy.cn）
> 提交入口：登录后 → 资产管理 → 新建资产 → Connector → 上传 zip → 提交审核

## 一、提交物

**zip 包**：`connector-upload/bulu-browser-connector-v1.0.1.zip`（16.3 KB）

包内结构（与官方规范一致，正斜杠路径）：

```
bulu-browser-connector-v1.0.1.zip
├── connector-meta.json          # 元信息（名称/描述/示例/source）
├── mcp.json                     # stdio 连接配置（npx + node 运行时声明）
├── icon.png                     # 128×128 透明背景图标
└── skills/bulu-browser/SKILL.md # 15 个工具的用途、参数、工作流、故障排查
```

## 二、connector-meta.json 关键字段

| 字段 | 值 |
|---|---|
| source（全局唯一 ID） | `bulu-browser` |
| 显示名 | 布噜浏览器 / Bulu Browser |
| 类型 | `mcp`（stdio 本地进程） |
| auth_mode | 省略（无需认证） |
| version | 1.0.1（与 npm 包版本一致） |

描述（中文，90 字）：
> 用本机真实 Chrome 打开网页、读取页面结构与可交互元素、点击输入、整页截图，并抓取页面网络请求和 console 日志。登录态保存在独立 profile 中，重启后依然有效。

## 三、连接方案说明

- **形态**：stdio 本地 MCP，命令 `npx -y bulu-browser-mcp@1.0.1`
- **运行时**：已声明 `runtime: { type: "node", version: ">=18.0.0" }`，用户无 Node 也可运行；
  npm 源配置了 npmmirror → npmjs 双源 fallback
- **依赖**：本机需有 Chrome / Edge / Brave 任一（自动发现，支持 `BULU_CHROME_PATH` 指定）
- **无云端服务**：全部在用户本机运行，不收集、不上传任何用户数据

## 四、自查清单（对照官方提交检查清单）

- [x] connector-meta.json 完整，source 为 kebab-case 且全局唯一
- [x] 提供中英文描述（zh 90 字）与中英文使用示例（各 4 条）
- [x] icon.png 128×128 透明背景
- [x] 未在任何文件写入 Token / 密钥 / API Key
- [x] mcp.json 仅含一个 Server；stdio 无需 HTTPS 要求
- [x] SKILL.md 含 frontmatter（name/description/version/author）及全部 15 个工具说明
- [x] 无 auth_mode → 无需 token-schema / server_auth
- [x] 未声明带版本标记的字段，无需 minWorkbuddyVersion
  - 注：`runtime` / `npmRegistries` 为 v5.0.0 字段，若审核端版本较旧报错，可删除这两项
    （改为依赖用户本机 Node）后重打包

## 五、审核员可能关注的问题（预答）

**Q：这个连接器会做什么？**
A：在本机启动一个独立 profile 的 Chromium 内核浏览器（Chrome/Edge/Brave 自动发现），
通过 CDP + Playwright 让 AI 读写页面、点击输入、截图、查看网络请求。
启动时自动清理 loopback 代理环境变量，仅监听 127.0.0.1。

**Q：安全性？**
A：① 全程本地运行，无云端组件，无遥测；② 浏览器使用独立 user-data-dir，
不读取用户日常浏览器的 Cookie/密码；③ 端口在 127.0.0.1 随机区间，仅本机可连；
④ 下载/截图写入系统临时目录；⑤ 源码 MIT 开源可审计：
https://github.com/Jevin0201/bulu-browser

**Q：依赖发布渠道？**
A：npm 包 `bulu-browser-mcp`（已发布 1.0.1，官方 MCP Registry 已收录
`io.github.Jevin0201/bulu-browser`），版本锁定，更新走连接器版本迭代。

**Q：用户数据流向？**
A：无。所有页面数据仅在用户本机的 AI 与浏览器之间流转，连接器本身不发起任何
上传请求（唯一的网络行为是从 npm 拉取依赖包）。

## 六、线上资产（供申请表填写）

- npm：https://www.npmjs.com/package/bulu-browser-mcp
- GitHub：https://github.com/Jevin0201/bulu-browser
- MCP Registry：`io.github.Jevin0201/bulu-browser`
  （查询：https://registry.modelcontextprotocol.io/v0/servers?search=bulu-browser）

## 七、提交流程备忘（人工步骤）

1. 打开 https://open.workbuddy.cn → 右上角「立即入驻」/ 登录（微信扫码）
2. 个人实名认证（如未做）
3. 「设置 → 开发者信息」补齐头像/昵称/简介/联系方式
4. 「资产管理 → 新建资产 → Connector」→ 上传本 zip
5. 若提示 source 重复 → 改一个唯一 kebab-case（如 `bulu-browser-mcp`）重新打包
6. 提交审核（安全扫描 + AI 审核 + 人工抽检，通常 10–15 分钟；也有反馈称约 7 个工作日）
7. 通过后在后台点「发布」→ 上架连接器市场
