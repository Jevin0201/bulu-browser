#!/usr/bin/env node
import { createInterface } from "node:readline"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { session } from "./driver.mjs"

const SERVER_INFO = { name: "bulu-browser", version: "1.0.0" }
const PROTOCOL = "2024-11-05"

const TOOLS = [
  {
    name: "browser_open",
    description:
      "打开网页。这是所有浏览器操作的起点。返回 tabId、页面标题和当前标签列表。url 可以写完整地址（https://example.com），也可以只写域名（example.com 会自动补 https），如果不像网址会自动当成搜索词。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "要打开的网址或搜索词" },
        newTab: { type: "boolean", description: "是否在新标签页打开，默认复用当前标签" },
        tabId: { type: "string", description: "在指定标签页打开" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_snapshot",
    description:
      "读取当前页面。返回可见文本 text 和可交互元素清单 refs。refs 是紧凑文本格式，一行一个元素，行首就是 ref，例如：\n5:12 textarea role=combobox ph=\"搜索网页\"\n5:13 button \"搜索\"\n把行首的 ref 传给 browser_act 即可操作。字段含义：label=可访问标签，ph=placeholder，val=当前值，disabled/checked/selected/expanded=状态。操作元素后 ref 会失效，需要重新 snapshot。页面很长时 snapshot.complete=false，用 nextTextOffset / nextRefOffset 继续读。",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "目标标签，默认当前标签" },
        selector: { type: "string", description: "可选 CSS 选择器，只读取该区域的文本（refs 仍返回全页）" },
        maxTextChars: { type: "number", description: "返回的文本字符上限，默认 12000，最大 50000" },
        maxRefs: { type: "number", description: "返回的元素引用数量上限，默认 120，最大 500；传 0 表示只采集文本" },
        textOffset: { type: "number", description: "文本分页起点，从上次的 nextTextOffset 继续" },
        refOffset: { type: "number", description: "元素分页起点，从上次的 nextRefOffset 继续" },
        detailed: { type: "boolean", description: "true 时 refs 返回结构化 JSON 数组（字段全），默认 false 返回紧凑文本" },
        preserveRefs: { type: "boolean", description: "true 时保留已有 ref 不重新分配，适合连续读取同一页面" },
      },
    },
  },
  {
    name: "browser_act",
    description:
      "对页面元素执行操作：点击、双击、悬停、输入、下拉选择、勾选。用 snapshot 拿到的 ref 定位（推荐），也可以用 CSS selector。可传 expect 让服务端在操作后直接验证结果，省掉一次额外快照。",
    inputSchema: {
      type: "object",
      properties: {
        ref: { type: "string", description: "browser_snapshot 返回的 ref，例如 5:12" },
        selector: { type: "string", description: "CSS 选择器（没有 ref 时使用）" },
        interaction: {
          type: "string",
          enum: ["click", "double_click", "hover", "type", "select", "check", "uncheck", "focus", "scroll_into_view"],
          description: "操作类型",
        },
        text: { type: "string", description: "interaction=type 时要输入的文字" },
        option: { type: "string", description: "interaction=select 时要选中的选项文本或 value" },
        expect: {
          type: "object",
          description: "操作后立即验证，避免再发一次 snapshot 确认",
          properties: {
            url: { type: "string", description: "期望跳转到的 URL 片段" },
            text: { type: "string", description: "期望页面出现的文本" },
            selector: { type: "string", description: "期望存在的元素选择器" },
            value: { type: "string", description: "配合 selector，期望输入框的值" },
            state: {
              type: "string",
              enum: ["attached", "detached", "visible", "hidden"],
              description: "配合 selector，默认 visible",
            },
          },
        },
        expectTimeoutMs: { type: "number", description: "expect 等待上限，默认 8000" },
        onDialog: {
          type: "string",
          enum: ["accept", "dismiss"],
          description: "这次操作触发 alert/confirm 时怎么处理，默认 dismiss。提交确认框要选 accept",
        },
        dialogText: { type: "string", description: "onDialog=accept 时填给 prompt 对话框的文本" },
        settleMs: { type: "number", description: "操作后固定等待毫秒数，默认等 DOM 稳定约 180ms" },
        tabId: { type: "string", description: "目标标签，默认当前标签" },
      },
      required: ["interaction"],
    },
  },
  {
    name: "browser_batch",
    description:
      "一次调用执行多步操作，用于填表单等连续动作：把 steps 数组一次性传进来，服务端按顺序执行并返回每步结果。遇到失败会立即停止并报告停在哪一步。注意：steps 里的 ref 都来自同一次 snapshot，所以只适合「不改变页面结构」的连续动作（填多个输入框、连续勾选）；会触发跳转或弹层的操作请放在最后一步，或改用多次 browser_act。",
    inputSchema: {
      type: "object",
      properties: {
        steps: {
          type: "array",
          description: "要执行的操作列表，最多 25 步",
          items: {
            type: "object",
            properties: {
              ref: { type: "string", description: "元素 ref" },
              selector: { type: "string", description: "或用 CSS 选择器" },
              interaction: {
                type: "string",
                enum: ["click", "double_click", "hover", "type", "select", "check", "uncheck", "focus", "scroll_into_view"],
              },
              text: { type: "string", description: "interaction=type 时的文字" },
              option: { type: "string", description: "interaction=select 时的选项" },
              onDialog: { type: "string", enum: ["accept", "dismiss"] },
              settleMs: { type: "number" },
            },
            required: ["interaction"],
          },
        },
        expect: {
          type: "object",
          description: "整批执行完后的验证条件，字段同 browser_act 的 expect",
          properties: {
            url: { type: "string" },
            text: { type: "string" },
            selector: { type: "string" },
            value: { type: "string" },
            state: { type: "string", enum: ["attached", "detached", "visible", "hidden"] },
          },
        },
        expectTimeoutMs: { type: "number" },
        tabId: { type: "string", description: "目标标签" },
      },
      required: ["steps"],
    },
  },
  {
    name: "browser_downloads",
    description: "列出本会话中触发的文件下载（文件名、来源、保存路径、状态）。点击导出/下载类按钮后用它取文件路径。",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "目标标签" },
        limit: { type: "number", description: "返回条数上限，默认 20" },
      },
    },
  },
  {
    name: "browser_press_key",
    description: "发送键盘按键，例如 Enter、Escape、Tab、Control+A、ArrowDown。常用于提交搜索框或关闭弹层。",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "按键名称，如 Enter" },
        tabId: { type: "string", description: "目标标签" },
      },
      required: ["key"],
    },
  },
  {
    name: "browser_screenshot",
    description: "对当前页面截图并保存为 PNG 文件，返回文件绝对路径。需要看图时用该路径读取图片。",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "目标标签" },
        fullPage: { type: "boolean", description: "是否整页截图，默认 true" },
      },
    },
  },
  {
    name: "browser_tabs",
    description: "列出所有标签页（tabId、url、title、是否为当前标签）。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "browser_select_tab",
    description: "切换当前标签页。",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "string", description: "要切换到的标签" } },
      required: ["tabId"],
    },
  },
  {
    name: "browser_close_tab",
    description: "关闭指定标签页。",
    inputSchema: {
      type: "object",
      properties: { tabId: { type: "string", description: "要关闭的标签，默认当前标签" } },
    },
  },
  {
    name: "browser_request",
    description:
      "在页面上下文中发起 HTTP 请求（自动携带该站点的 Cookie 和登录态），用于调用页面自己的 API 或获取 JSON 数据。Cookie/Origin/Referer 等头部无法覆盖。",
    inputSchema: {
      type: "object",
      properties: {
        url: { type: "string", description: "绝对地址，或相对当前页面的路径" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        headers: { type: "object", description: "附加请求头（键值对）" },
        body: { type: "string", description: "请求体" },
        maxResponseChars: { type: "number", description: "返回内容字符上限，默认 4000" },
        tabId: { type: "string", description: "目标标签" },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_network",
    description:
      "查看当前标签最近的网络请求（方法、URL、状态码、类型），用于分析页面接口。action=list 列请求，action=body 取指定 URL 的响应体。",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "body"], description: "list 列请求，body 取响应体" },
        filter: { type: "string", description: "按 URL 片段过滤" },
        status: { type: "number", description: "按状态码过滤" },
        limit: { type: "number", description: "返回条数上限，默认 50" },
        url: { type: "string", description: "action=body 时要抓取的 URL" },
        tabId: { type: "string", description: "目标标签" },
      },
    },
  },
  {
    name: "browser_console",
    description: "读取页面 console 日志和 JS 报错，用于排查页面问题。",
    inputSchema: {
      type: "object",
      properties: {
        tabId: { type: "string", description: "目标标签" },
        limit: { type: "number", description: "返回条数上限，默认 100" },
      },
    },
  },
  {
    name: "browser_get_content",
    description: "导出当前页面的完整正文文本或 HTML 源码，适合需要全文分析、保存资料时使用。",
    inputSchema: {
      type: "object",
      properties: {
        format: { type: "string", enum: ["text", "html"], description: "text 纯文本，html 源码" },
        tabId: { type: "string", description: "目标标签" },
      },
    },
  },
  {
    name: "browser_close",
    description: "关闭浏览器并释放资源。任务结束后可调用；不调用也不会影响后续使用。",
    inputSchema: { type: "object", properties: {} },
  },
]

async function callTool(name, args = {}) {
  switch (name) {
    case "browser_open":
      return session.open(args.url, args)
    case "browser_navigate":
      return session.navigate(args.url, args)
    case "browser_snapshot":
      return session.snapshot(args)
    case "browser_act":
      return session.act(args)
    case "browser_batch":
      return session.batch(args)
    case "browser_downloads":
      return session.downloadsList(args)
    case "browser_press_key":
      return session.pressKey(args.key, args)
    case "browser_tabs":
      return { tabs: await session.listTabs(), activeTabId: session.activeTabId }
    case "browser_select_tab":
      return session.selectTab(args.tabId)
    case "browser_close_tab":
      return session.closeTab(args.tabId)
    case "browser_request":
      return session.request(args)
    case "browser_network":
      return args.action === "body" ? session.networkBody(args) : session.networkList(args)
    case "browser_console":
      return session.consoleLog(args)
    case "browser_get_content":
      return session.saveDocument(args.format ?? "text", args)
    case "browser_screenshot": {
      const result = await session.screenshot(args)
      const dir = path.join(os.tmpdir(), "bulu-browser", "shots")
      mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `shot-${Date.now()}.png`)
      writeFileSync(file, Buffer.from(result.base64, "base64"))
      return { path: file, bytes: result.bytes, url: result.url, title: result.title, tabId: result.tabId }
    }
    case "browser_close":
      return session.close()
    default:
      throw new Error(`未知工具: ${name}`)
  }
}

function reply(id, payload) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...payload })}\n`)
}

async function handle(message) {
  const { id, method, params } = message
  if (method === "initialize") {
    return reply(id, {
      result: {
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      },
    })
  }
  if (method === "notifications/initialized" || method === "initialized") return
  if (method === "ping") return reply(id, { result: {} })
  if (method === "tools/list") return reply(id, { result: { tools: TOOLS } })
  if (method === "tools/call") {
    const name = params?.name
    const args = params?.arguments ?? {}
    try {
      const result = await callTool(name, args)
      return reply(id, {
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], isError: false },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`[bulu] tool ${name} failed: ${message}\n`)
      return reply(id, { result: { content: [{ type: "text", text: `操作失败: ${message}` }], isError: true } })
    }
  }
  if (method === "resources/list") return reply(id, { result: { resources: [] } })
  if (method === "prompts/list") return reply(id, { result: { prompts: [] } })
  if (id !== undefined) {
    return reply(id, { error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

async function main() {
  if (process.argv.includes("--open")) {
    const index = process.argv.indexOf("--open")
    const target = process.argv[index + 1]
    const url = target && !target.startsWith("--") ? target : undefined
    const info = await session.open(url)
    const page = await session.page().catch(() => null)
    await page?.bringToFront().catch(() => undefined)
    console.log(`WorkBuddy 浏览器已就绪 · 端口 ${session.launch?.port ?? "-"} · profile ${session.launch?.profileDir ?? "-"}`)
    if (info.url && info.url !== "about:blank") console.log(`当前页面: ${info.url}`)
    // 不调用 close：Chrome 是 detached 的，本进程退出后它继续存活，下次直接复用
    process.exit(0)
  }
  if (process.argv.includes("--status")) {
    const { readJsonSafe, defaultProfileDir } = await import("./chrome.mjs")
    const path = await import("node:path")
    const dir = defaultProfileDir()
    const port = readJsonSafe(path.join(dir, ".bulu-port"))?.port
    let alive = false
    if (typeof port === "number") {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1200) })
        alive = response.ok
      } catch {}
    }
    console.log(JSON.stringify({ profileDir: dir, port: port ?? null, running: alive }, null, 2))
    process.exit(0)
  }
  if (process.argv.includes("--check")) {
    const info = await session.open("https://example.com")
    console.log(JSON.stringify({ ok: true, ...info }, null, 2))
    await session.close()
    return
  }
  process.stderr.write("[bulu] bulu-browser MCP server started\n")
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  let queue = Promise.resolve()
  rl.on("line", (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let message
    try {
      message = JSON.parse(trimmed)
    } catch {
      process.stderr.write(`[bulu] 无法解析的输入: ${trimmed.slice(0, 200)}\n`)
      return
    }
    queue = queue.then(() =>
      handle(message).catch((error) => {
        process.stderr.write(`[bulu] handler error: ${error?.message ?? error}\n`)
        if (message?.id !== undefined)
          reply(message.id, { error: { code: -32603, message: String(error?.message ?? error) } })
      }),
    )
  })
  rl.on("close", () => {
    queue.finally(() => session.close().finally(() => process.exit(0)))
  })
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void session.close().finally(() => process.exit(0))
    })
  }
}

main().catch((error) => {
  process.stderr.write(`[bulu] fatal: ${error?.message ?? error}\n`)
  process.exit(1)
})
