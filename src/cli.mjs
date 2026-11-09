// 命令行入口：让「技能（Skill）」形态也能驱动浏览器。
// 每次调用是一个独立进程，但会复用已在运行的 Chrome（见 chrome.mjs 的 takeOverRunningInstance），
// 因此登录态、Cookie 和已打开的标签页在多次调用之间保持。

import { mkdirSync, writeFileSync, readFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { session } from "./driver.mjs"

// 每次 CLI 调用都是新进程，标签页顺序会重排，默认激活的可能是错的页。
// 这里把上一次操作的页面 URL 记下来，下次启动时优先恢复它。
const STATE_FILE = path.join(os.tmpdir(), "bulu-browser", "active-tab.json")

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"))
  } catch {
    return null
  }
}

function rememberTab(result) {
  if (!result || typeof result !== "object" || !result.url) return
  try {
    mkdirSync(path.dirname(STATE_FILE), { recursive: true })
    writeFileSync(STATE_FILE, JSON.stringify({ url: result.url, tabId: result.tabId }), "utf8")
  } catch {}
}

async function restoreTab() {
  const state = readState()
  if (!state?.url) return
  await session.ensure()
  const pages = session.context.pages().filter((page) => !page.isClosed())
  const match = pages.find((page) => page.url() === state.url)
  if (match) session.activeTabId = session.pageId(match)
}

const HELP = `bulu-browser CLI

用法: bulu-browser-mcp cli <command> [args] [--flag value]

命令:
  open <url> [--new-tab] [--tab <id>]        打开网页（不传 url 则用当前页）
  snapshot [--tab <id>] [--selector <css>]   读取页面文本与可交互元素 refs
           [--max-text <n>] [--max-refs <n>] [--detailed]
  act --interaction <type> [--ref <ref>|--selector <css>]
      [--text <内容>] [--option <选项>] [--on-dialog accept|dismiss]
      [--expect-text <文本>] [--settle <ms>]  对元素执行操作
  batch --steps <json>                        连续执行多步操作
  screenshot [--full] [--out <路径>]          截图，返回保存路径
  content [--max-chars <n>]                   获取页面 HTML
  network [--filter <关键字>] [--limit <n>]   查看网络请求列表
  network-body <url>                          重新获取某个请求的响应体
  console [--limit <n>]                       查看页面 console 日志
  tabs                                        列出所有标签页
  select-tab <id>                             切换当前标签页
  close-tab <id>                              关闭标签页
  key <键名>                                  发送按键（Space/Enter/Escape/ArrowDown...）
  quit                                        关闭整个浏览器（保留登录态）
  help                                        显示本帮助

所有命令输出 JSON。示例:
  bulu-browser-mcp cli open https://example.com
  bulu-browser-mcp cli snapshot --max-refs 60
  bulu-browser-mcp cli act --ref 5:12 --interaction click
`

function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i]
    if (!item.startsWith("--")) {
      positional.push(item)
      continue
    }
    const body = item.slice(2)
    const eq = body.indexOf("=")
    if (eq !== -1) {
      flags[body.slice(0, eq)] = body.slice(eq + 1)
      continue
    }
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) {
      flags[body] = true
    } else {
      flags[body] = next
      i += 1
    }
  }
  return { positional, flags }
}

const num = (value, fallback) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function shotPath() {
  const dir = path.join(os.tmpdir(), "bulu-browser", "shots")
  mkdirSync(dir, { recursive: true })
  return path.join(dir, `shot-${Date.now()}.png`)
}

async function run(argv) {
  const { positional, flags } = parseArgs(argv)
  const command = positional[0] ?? "help"
  const rest = positional.slice(1)

  switch (command) {
    case "help":
    case "--help":
    case "-h":
      return { help: HELP }

    case "open": {
      const target = rest[0] ?? flags.url
      if (!target) throw new Error("open 需要 url，例如: cli open https://example.com")
      return session.open(target, {
        newTab: flags["new-tab"] === true,
        tabId: flags.tab,
        timeoutMs: num(flags.timeout, undefined),
      })
    }

    case "snapshot":
      return session.snapshot({
        tabId: flags.tab,
        selector: flags.selector,
        detailed: flags.detailed === true,
        preserveRefs: flags["preserve-refs"] === true,
        maxTextChars: num(flags["max-text"], undefined),
        maxRefs: num(flags["max-refs"], undefined),
      })

    case "act": {
      if (!flags.interaction) throw new Error("act 需要 --interaction，例如 --interaction click")
      if (!flags.ref && !flags.selector) throw new Error("act 需要 --ref 或 --selector 指定目标元素")
      return session.act({
        tabId: flags.tab,
        ref: flags.ref,
        selector: flags.selector,
        interaction: flags.interaction,
        text: flags.text,
        option: flags.option,
        onDialog: flags["on-dialog"],
        dialogText: flags["dialog-text"],
        settleMs: num(flags.settle, undefined),
        expect: flags["expect-text"] || flags["expect-url"] ? { text: flags["expect-text"], url: flags["expect-url"] } : undefined,
        expectTimeoutMs: num(flags["expect-timeout"], undefined),
      })
    }

    case "batch": {
      let steps = flags.steps
      if (typeof steps === "string") {
        try {
          steps = JSON.parse(steps)
        } catch (error) {
          throw new Error(`--steps 不是合法 JSON: ${error.message}`)
        }
      }
      if (!Array.isArray(steps)) throw new Error("batch 需要 --steps '[{...}]'")
      return session.batch({ tabId: flags.tab, steps })
    }

    case "screenshot": {
      const result = await session.screenshot({ tabId: flags.tab, fullPage: flags.full !== false })
      const file = flags.out ? path.resolve(String(flags.out)) : shotPath()
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, Buffer.from(result.base64, "base64"))
      delete result.base64
      return { ...result, path: file }
    }

    case "content": {
      const result = await session.saveDocument("html", { tabId: flags.tab })
      const maxChars = num(flags["max-chars"], 100_000)
      const content = result.content ?? ""
      return {
        url: result.url,
        totalChars: content.length,
        truncated: content.length > maxChars || undefined,
        content: content.slice(0, maxChars),
      }
    }

    case "network":
      return session.networkList({
        tabId: flags.tab,
        filter: flags.filter,
        status: num(flags.status, undefined),
        limit: num(flags.limit, 50),
      })

    case "network-body": {
      const url = rest[0] ?? flags.url
      if (!url) throw new Error("network-body 需要 url")
      return session.networkBody({ url, tabId: flags.tab })
    }

    case "console":
      return session.consoleLog({ tabId: flags.tab, limit: num(flags.limit, 100) })

    case "tabs":
      return { tabs: await session.listTabs() }

    case "select-tab": {
      const id = rest[0] ?? flags.tab
      if (!id) throw new Error("select-tab 需要 tabId（用 cli tabs 查看）")
      return session.selectTab(id)
    }

    case "close-tab": {
      const id = rest[0] ?? flags.tab
      if (!id) throw new Error("close-tab 需要 tabId")
      return session.closeTab(id)
    }

    case "key": {
      const key = rest[0] ?? flags.key
      if (!key) throw new Error("key 需要键名，例如: cli key Space")
      return session.pressKey(key, { tabId: flags.tab })
    }

    case "quit": {
      await session.ensure()
      const browser = session.browser
      if (browser) {
        try {
          const cdp = await browser.newBrowserCDPSession()
          await cdp.send("Browser.close")
        } catch {}
        await browser.close().catch(() => {})
      }
      return { closed: true }
    }

    default:
      throw new Error(`未知命令: ${command}\n\n${HELP}`)
  }
}

export async function cli(argv) {
  let code = 0
  try {
    const parsedCommand = (argv[0] ?? "help").trim()
    if (!["help", "--help", "-h", "quit"].includes(parsedCommand)) await restoreTab()
    const result = await run(argv)
    rememberTab(result)
    if (typeof result === "string") process.stdout.write(result)
    else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  } catch (error) {
    code = 1
    process.stdout.write(`${JSON.stringify({ ok: false, error: String(error?.message ?? error) }, null, 2)}\n`)
  }
  // CDP 连接会让事件循环常驻，浏览器是独立进程，直接退出即可（不要 close，否则会关掉用户的浏览器）
  process.stdout.write("", () => process.exit(code))
}
