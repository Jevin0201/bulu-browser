import { chromium } from "playwright-core"
import { mkdirSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import {
  clearLoopbackProxy,
  connectExternal,
  defaultProfileDir,
  killTree,
  launchChrome,
  waitExit,
} from "./chrome.mjs"
import { REF_ATTRIBUTE, captureSnapshot, semanticState } from "./snapshot.mjs"

const NETWORK_LIMIT = 300
const CONSOLE_LIMIT = 200

export class BrowserSession {
  constructor(options = {}) {
    this.options = options
    this.browser = null
    this.context = null
    this.launch = null
    this.launching = null
    this.tabs = new Map()
    this.pageIds = new WeakMap()
    this.nextPageId = 1
    this.epochs = new WeakMap()
    this.activeTabId = null
    this.network = []
    this.consoleEntries = []
    this.dialogs = []
    this.downloads = []
    this.dialogPolicy = "dismiss"
    this.dialogPromptText = ""
    this.registered = new WeakSet()
    this.hooked = new WeakSet()
  }

  log(message) {
    process.stderr.write(`[bulu] ${message}\n`)
  }

  async ensure() {
    if (this.browser?.isConnected()) return this.browser
    this.launching ??= this.connect().finally(() => {
      this.launching = null
    })
    return this.launching
  }

  async connect() {
    clearLoopbackProxy()
    const external = process.env.BULU_CDP_URL?.trim()
    this.launch = external ? await connectExternal(external) : await launchChrome(this.options)
    this.log(`CDP ready on port ${this.launch.port} (${this.launch.browser ?? "unknown"})`)
    const browser = await chromium.connectOverCDP(this.launch.wsUrl, { timeout: 30_000 })
    browser.on("disconnected", () => {
      this.log("browser disconnected")
      this.browser = null
      this.context = null
      this.tabs.clear()
    })
    const context = browser.contexts()[0]
    if (!context) throw new Error("CDP 连接成功但 Chrome 没有可用上下文")
    this.browser = browser
    this.context = context
    context.on("page", (page) => {
      this.registerPage(page)
      this.indexPage(page)
    })
    for (const page of context.pages()) {
      this.registerPage(page)
      this.indexPage(page)
    }
    return browser
  }

  indexPage(page) {
    const id = this.pageId(page)
    this.tabs.set(id, page)
    if (!this.activeTabId) this.activeTabId = id
    return id
  }

  pageId(page) {
    let id = this.pageIds.get(page)
    if (!id) {
      id = `tab-${this.nextPageId++}`
      this.pageIds.set(page, id)
      this.epochs.set(page, 1)
    }
    return id
  }

  epoch(page) {
    return this.epochs.get(page) ?? 1
  }

  bumpEpoch(page) {
    this.epochs.set(page, this.epoch(page) + 1)
  }

  registerPage(page) {
    if (this.registered.has(page)) return
    this.registered.add(page)
    this.pageId(page)
    page.on("domcontentloaded", () => {
      this.bumpEpoch(page)
    })
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) this.bumpEpoch(page)
    })
    page.on("close", () => {
      const id = this.pageIds.get(page)
      if (id) this.tabs.delete(id)
    })
    page.on("dialog", async (dialog) => {
      const record = { type: dialog.type(), message: dialog.message(), tabId: this.pageId(page), handled: this.dialogPolicy }
      this.dialogs.push(record)
      try {
        if (this.dialogPolicy === "accept") await dialog.accept(this.dialogPromptText || undefined)
        else if (this.dialogPolicy === "manual") record.handled = "pending"
        else await dialog.dismiss()
      } catch {}
    })
    page.on("download", async (download) => {
      const dir = path.join(os.tmpdir(), "bulu-browser", "downloads")
      try {
        mkdirSync(dir, { recursive: true })
        const suggested = download.suggestedFilename() || `download-${Date.now()}`
        const target = path.join(dir, `${Date.now()}-${suggested}`)
        await download.saveAs(target)
        this.downloads.push({
          at: Date.now(),
          tabId: this.pageId(page),
          url: download.url(),
          filename: suggested,
          path: target,
          status: "completed",
        })
      } catch (error) {
        this.downloads.push({
          at: Date.now(),
          tabId: this.pageId(page),
          url: download.url(),
          filename: download.suggestedFilename(),
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })
    page.on("console", (message) => push(this.consoleEntries, {
      at: Date.now(),
      tabId: this.pageId(page),
      type: message.type(),
      text: message.text().slice(0, 1000),
    }))
    page.on("pageerror", (error) =>
      push(this.consoleEntries, { at: Date.now(), tabId: this.pageId(page), type: "pageerror", text: error.message.slice(0, 1000) }),
    )
    page.on("response", (response) => {
      const request = response.request()
      push(this.network, {
        at: Date.now(),
        tabId: this.pageId(page),
        method: request.method(),
        url: response.url().slice(0, 500),
        status: response.status(),
        resourceType: request.resourceType(),
        contentType: response.headers()["content-type"] ?? "",
      })
    })
  }

  async page(tabId) {
    await this.ensure()
    const id = tabId ?? this.activeTabId
    const page = id ? this.tabs.get(id) : undefined
    if (page && !page.isClosed()) return page
    if (tabId) throw new Error(`标签 ${tabId} 已关闭，请先调用 browser_tabs 获取最新列表`)
    const pages = this.context.pages().filter((item) => !item.isClosed())
    const fallback = pages[pages.length - 1]
    if (!fallback) throw new Error("当前浏览器没有可用标签页")
    this.activeTabId = this.pageId(fallback)
    this.tabs.set(this.activeTabId, fallback)
    return fallback
  }

  async listTabs() {
    await this.ensure()
    const pages = this.context.pages().filter((item) => !item.isClosed())
    return Promise.all(
      pages.map(async (page) => {
        const id = this.indexPage(page)
        return {
          tabId: id,
          url: page.url(),
          title: await page.title().catch(() => ""),
          active: id === this.activeTabId,
        }
      }),
    )
  }

  async open(url, options = {}) {
    await this.ensure()
    const requested = url ?? options.url
    const target = requested ? normalizeUrl(requested) : "about:blank"
    if (target !== "about:blank") assertUrlAllowed(target)
    let page
    if (options.newTab) {
      page = await this.context.newPage()
      this.registerPage(page)
      this.indexPage(page)
    } else {
      page = await this.page(options.tabId).catch(() => null)
      if (!page) {
        page = await this.context.newPage()
        this.registerPage(page)
        this.indexPage(page)
      }
    }
    if (target && page.url() !== target) await page.goto(target, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 45_000 })
    this.activeTabId = this.pageId(page)
    this.bumpEpoch(page)
    return this.describe(page)
  }

  async navigate(url, options = {}) {
    const page = await this.page(options.tabId)
    const target = normalizeUrl(url)
    assertUrlAllowed(target)
    await page.goto(target, { waitUntil: "domcontentloaded", timeout: options.timeoutMs ?? 45_000 })
    this.bumpEpoch(page)
    this.activeTabId = this.pageId(page)
    return this.describe(page)
  }

  async describe(page) {
    return {
      tabId: this.pageId(page),
      url: page.url(),
      title: await page.title().catch(() => ""),
      tabs: await this.listTabs().catch(() => []),
    }
  }

  async snapshot(options = {}) {
    const page = await this.page(options.tabId)
    if (options.selector) await page.locator(options.selector).count().catch(() => 0)
    if (!options.preserveRefs) this.bumpEpoch(page)
    const result = await captureSnapshot(page, { ...options, epoch: this.epoch(page) })
    const detailed = options.detailed === true
    return {
      tabId: this.pageId(page),
      url: result.url,
      title: result.title,
      text: result.text,
      refs: detailed ? result.refs : result.refs.map(formatRef).join("\n"),
      refCount: result.refs.length,
      snapshot: result.snapshot,
      surfaces: result.surfaces,
    }
  }

  async act(input) {
    const page = await this.page(input.tabId)
    const before = await semanticState(page)
    const locator = await this.resolve(page, input)
    if (!locator) throw notFound(input)

    this.dialogPolicy = input.onDialog === "accept" ? "accept" : "dismiss"
    this.dialogPromptText = input.dialogText ?? ""
    try {
      await this.interact(locator, input)
    } finally {
      this.dialogPolicy = "dismiss"
    }
    await this.settle(page, input)
    const after = await semanticState(page)
    const expectation = input.expect ? await this.waitExpectation(page, input.expect, input.expectTimeoutMs) : undefined
    return {
      ...(await this.describe(page)),
      changes: describeChanges(before, after),
      ...(expectation ? { expect: expectation } : {}),
      dialog: this.dialogs[this.dialogs.length - 1] ?? null,
    }
  }

  async batch(input) {
    const page = await this.page(input.tabId)
    const steps = Array.isArray(input.steps) ? input.steps : []
    if (steps.length === 0) throw new Error("batch 需要 steps 数组，例如 [{ref:'5:1', interaction:'type', text:'x'}]")
    if (steps.length > 25) throw new Error("batch 单次最多 25 步，请拆分调用")

    const before = await semanticState(page)
    const results = []
    let stopped = false
    for (const [index, step] of steps.entries()) {
      const target = step.ref ?? step.selector
      try {
        if (!step.interaction) throw new Error("每一步都需要 interaction")
        const locator = await this.resolve(page, step)
        if (!locator) throw notFound(step)
        this.dialogPolicy = step.onDialog === "accept" ? "accept" : "dismiss"
        this.dialogPromptText = step.dialogText ?? ""
        await this.interact(locator, step)
        await page.waitForTimeout(step.settleMs ?? 120)
        results.push({ step: index + 1, ok: true, interaction: step.interaction, target })
      } catch (error) {
        stopped = true
        results.push({
          step: index + 1,
          ok: false,
          interaction: step.interaction,
          target,
          error: error instanceof Error ? error.message : String(error),
        })
        break
      } finally {
        this.dialogPolicy = "dismiss"
      }
    }

    await this.settle(page, input)
    const after = await semanticState(page)
    const expectation = input.expect ? await this.waitExpectation(page, input.expect, input.expectTimeoutMs) : undefined
    return {
      ...(await this.describe(page)),
      total: steps.length,
      executed: results.length,
      stopped,
      results,
      changes: describeChanges(before, after),
      ...(expectation ? { expect: expectation } : {}),
    }
  }

  async resolve(page, input) {
    if (input.ref) return locatorInFrames(page, `[${REF_ATTRIBUTE}="${cssEscape(input.ref)}"]`)
    if (input.selector) return locatorInFrames(page, input.selector)
    return null
  }

  async interact(locator, input) {
    switch (input.interaction) {
      case "click":
        await locator.click({ timeout: input.timeoutMs ?? 15_000 })
        return
      case "double_click":
        await locator.dblclick({ timeout: input.timeoutMs ?? 15_000 })
        return
      case "hover":
        await locator.hover({ timeout: input.timeoutMs ?? 15_000 })
        return
      case "focus":
        await locator.focus()
        return
      case "type":
        if (typeof input.text !== "string") throw new Error("type 需要 text 参数")
        await locator.fill("")
        await locator.fill(input.text, { timeout: input.timeoutMs ?? 15_000 })
        return
      case "select":
        if (typeof input.option !== "string") throw new Error("select 需要 option 参数")
        try {
          await locator.selectOption({ label: input.option })
        } catch {
          await locator.selectOption({ value: input.option })
        }
        return
      case "check":
        await locator.check()
        return
      case "uncheck":
        await locator.uncheck()
        return
      case "scroll_into_view":
        await locator.scrollIntoViewIfNeeded()
        return
      default:
        throw new Error(`不支持的 interaction: ${input.interaction}`)
    }
  }

  async settle(page, input) {
    if (typeof input.settleMs === "number") {
      await page.waitForTimeout(input.settleMs)
      return
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => undefined)
    await page.waitForTimeout(180)
  }

  async waitExpectation(page, expectation, timeoutMs = 8000) {
    const limit = Math.min(Math.max(timeoutMs ?? 8000, 500), 30_000)
    try {
      if (expectation.url) {
        await page.waitForURL((url) => url.href.includes(expectation.url), { timeout: limit })
        return { ok: true, checked: "url", actual: page.url() }
      }
      if (expectation.text) {
        await page.waitForFunction(
          (text) => (document.body?.innerText ?? "").includes(text),
          expectation.text,
          { timeout: limit },
        )
        return { ok: true, checked: "text", actual: expectation.text }
      }
      if (expectation.selector) {
        const locator = page.locator(expectation.selector).first()
        await locator.waitFor({ state: expectation.state ?? "visible", timeout: limit })
        if (expectation.value !== undefined) {
          const actual = await locator.inputValue().catch(() => null)
          const ok = actual === expectation.value
          return { ok, checked: "selector+value", actual, expected: expectation.value }
        }
        return { ok: true, checked: "selector", actual: expectation.selector }
      }
      return { ok: false, checked: "none", error: "expect 需要 url / text / selector 之一" }
    } catch (error) {
      return {
        ok: false,
        checked: expectation.url ? "url" : expectation.text ? "text" : "selector",
        error: `等待超时（${limit}ms）：${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      }
    }
  }

  async pressKey(key, options = {}) {
    const page = await this.page(options.tabId)
    const before = await semanticState(page)
    await page.keyboard.press(key)
    await page.waitForTimeout(250)
    const after = await semanticState(page)
    return { ...(await this.describe(page)), changes: describeChanges(before, after) }
  }

  async screenshot(options = {}) {
    const page = await this.page(options.tabId)
    const buffer = await page.screenshot({ fullPage: options.fullPage !== false })
    return { ...(await this.describe(page)), base64: buffer.toString("base64"), bytes: buffer.length }
  }

  async clickAt(x, y, options = {}) {
    const page = await this.page(options.tabId)
    await page.mouse.click(x, y, { clickCount: options.count ?? 1 })
    return this.describe(page)
  }

  async scroll(options = {}) {
    const page = await this.page(options.tabId)
    if (typeof options.x === "number" && typeof options.y === "number") await page.mouse.move(options.x, options.y)
    await page.mouse.wheel(options.deltaX ?? 0, options.deltaY ?? 600)
    return this.describe(page)
  }

  async selectTab(tabId) {
    const page = await this.page(tabId)
    this.activeTabId = tabId
    await page.bringToFront().catch(() => {})
    return this.describe(page)
  }

  async closeTab(tabId) {
    const page = await this.page(tabId)
    await page.close()
    this.tabs.delete(tabId)
    if (this.activeTabId === tabId) {
      const next = this.context.pages().filter((item) => !item.isClosed())[0]
      this.activeTabId = next ? this.pageId(next) : null
    }
    return { closed: true, tabs: await this.listTabs().catch(() => []) }
  }

  async request(input) {
    const page = await this.page(input.tabId)
    const method = input.method ?? "GET"
    const response = await page.evaluate(
      async ({ url, method, headers, body, maxChars }) => {
        const target = new URL(url, location.href)
        if (!/^https?:$/.test(target.protocol)) throw new Error("只支持 HTTP/HTTPS")
        const result = await fetch(target.href, {
          method,
          headers,
          body: method === "GET" ? undefined : body,
          credentials: "include",
          redirect: "follow",
        })
        const text = await result.text()
        return {
          url: result.url,
          status: result.status,
          ok: result.ok,
          contentType: result.headers.get("content-type") ?? "",
          text: text.slice(0, maxChars),
          totalChars: text.length,
          truncated: text.length > maxChars || undefined,
        }
      },
      {
        url: input.url,
        method,
        headers: filterHeaders(input.headers ?? {}),
        body: input.body,
        maxChars: Math.min(Math.max(input.maxResponseChars ?? 4000, 100), 200_000),
      },
    )
    return { response }
  }

  async networkList(options = {}) {
    const tabId = options.tabId ?? this.activeTabId
    let items = this.network.filter((item) => !tabId || item.tabId === tabId)
    if (options.filter) items = items.filter((item) => item.url.includes(options.filter) || item.method === options.filter)
    if (options.status) items = items.filter((item) => item.status === options.status)
    return { total: items.length, items: items.slice(-Math.min(options.limit ?? 50, 200)).reverse() }
  }

  async networkBody(input) {
    const page = await this.page(input.tabId)
    const response = await page.evaluate(async (url) => {
      const result = await fetch(url, { credentials: "include" })
      const text = await result.text()
      return { status: result.status, text: text.slice(0, 20000), totalChars: text.length }
    }, input.url)
    return { url: input.url, ...response }
  }

  consoleLog(options = {}) {
    const tabId = options.tabId ?? this.activeTabId
    const items = this.consoleEntries.filter((item) => !tabId || item.tabId === tabId)
    return { total: items.length, items: items.slice(-Math.min(options.limit ?? 100, 200)) }
  }

  downloadsList(options = {}) {
    const tabId = options.tabId ?? this.activeTabId
    const items = this.downloads.filter((item) => !tabId || item.tabId === tabId)
    return { total: items.length, items: items.slice(-Math.min(options.limit ?? 20, 50)) }
  }

  async saveDocument(format, options = {}) {
    const page = await this.page(options.tabId)
    if (format === "html") return { content: await page.content(), url: page.url() }
    const text = await page.evaluate(() => document.body?.innerText ?? "")
    return { content: text, url: page.url(), title: await page.title().catch(() => "") }
  }

  async close() {
    const launch = this.launch
    this.launch = null
    const owned = Boolean(launch?.child)
    // 关键：用 CDP 让 Chrome 自己正常退出，它才会把 cookie / localStorage 写盘。
    // 直接 taskkill 会把登录态一起带走。
    if (this.browser && owned) {
      try {
        const cdp = await this.browser.newBrowserCDPSession()
        await cdp.send("Browser.close")
      } catch {}
    }
    if (this.browser) await this.browser.close().catch(() => {})
    this.browser = null
    let graceful = false
    if (owned) graceful = await waitExit(launch.child)
    return { closed: true, graceful, profileKept: this.launch?.profileDir ?? launch?.profileDir }
  }
}

function push(list, item, limit = NETWORK_LIMIT) {
  list.push(item)
  if (list.length > limit) list.splice(0, list.length - limit)
}

function trim(value, limit = 56) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text
}

// 紧凑单行格式：一个元素一行，省 50-60% token，模型仍能直接拿行首的 ref 去操作。
function formatRef(ref) {
  const parts = [ref.ref, ref.tag]
  if (ref.role) parts.push(`role=${ref.role}`)
  if (ref.type) parts.push(`type=${ref.type}`)
  if (ref.label) parts.push(`label="${trim(ref.label)}"`)
  if (ref.text && ref.text !== ref.label) parts.push(`"${trim(ref.text)}"`)
  if (ref.placeholder) parts.push(`ph="${trim(ref.placeholder)}"`)
  if (ref.value) parts.push(`val="${trim(ref.value)}"`)
  if (ref.checked !== undefined) parts.push(`checked=${ref.checked}`)
  if (ref.disabled) parts.push("disabled")
  if (ref.selected) parts.push("selected")
  if (ref.expanded !== undefined) parts.push(`expanded=${ref.expanded}`)
  return parts.join(" ")
}

function notFound(input) {
  if (!input.ref && !input.selector) return new Error("这一步需要 ref 或 selector 才能定位元素")
  const label = input.ref ? `ref ${input.ref}` : `选择器 ${input.selector}`
  return new Error(
    `${label} 已失效（页面可能已变化）。请重新调用 browser_snapshot 获取最新 ref；` +
      `如果页面确实没有该元素，检查选择器或是否需要先展开某个区域。`,
  )
}

function assertUrlAllowed(url) {
  const target = new URL(url)
  if (!/^https?:$/.test(target.protocol))
    throw new Error(`只允许 http/https，收到 ${target.protocol}（file:// 和 javascript: 被拒绝）`)
  const allowList = (process.env.BULU_ALLOWED_HOSTS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (allowList.length === 0) return
  const host = target.hostname.toLowerCase()
  const hit = allowList.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))
  if (!hit)
    throw new Error(
      `域名 ${host} 不在 BULU_ALLOWED_HOSTS 允许列表内（当前允许：${allowList.join(", ")}）。` +
        `如确需访问，请让用户更新该环境变量。`,
    )
}

function normalizeUrl(url) {
  const trimmed = String(url).trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) return `https://${trimmed}`
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`
}

function cssEscape(value) {
  return String(value).replace(/["\\]/g, "\\$&")
}

async function locatorInFrames(page, selector) {
  for (const frame of page.frames()) {
    try {
      const locator = frame.locator(selector).first()
      if ((await locator.count()) > 0) return locator
    } catch {}
  }
  return null
}

function filterHeaders(headers) {
  return Object.fromEntries(
    Object.entries(headers).filter(([name]) => !/^(cookie|host|origin|referer|content-length|sec-|proxy-)/i.test(name)),
  )
}

function describeChanges(before, after) {
  const changed = {
    urlChanged: before.url !== after.url,
    titleChanged: before.title !== after.title,
    textChanged: before.text !== after.text,
    controlCountChanged: before.count !== after.count,
  }
  const any = Object.values(changed).some(Boolean)
  return {
    ...changed,
    any,
    url: after.url,
    title: after.title,
    note: any ? "页面状态已变化，需要新的 ref 请重新 snapshot" : "页面状态未观察到明显变化",
  }
}

export const session = new BrowserSession()
export { defaultProfileDir }
