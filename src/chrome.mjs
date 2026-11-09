import { spawn } from "node:child_process"
import { createServer } from "node:net"
import { existsSync, mkdirSync, readFileSync, readlinkSync, unlinkSync, writeFileSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const LOOPBACK = "localhost,127.0.0.1,[::1]"
const PROXY_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]

export function clearLoopbackProxy() {
  for (const key of PROXY_KEYS) delete process.env[key]
  const current = process.env.NO_PROXY || process.env.no_proxy || ""
  const merged = current.includes("127.0.0.1") ? current : current ? `${current},${LOOPBACK}` : LOOPBACK
  process.env.NO_PROXY = merged
  process.env.no_proxy = merged
}

export function findChrome() {
  const configured = process.env.BULU_CHROME_PATH?.trim()
  if (configured && existsSync(configured)) return configured
  const candidates =
    process.platform === "win32"
      ? [
          path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env.ProgramFiles ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env["ProgramFiles(x86)"] ?? "", "Google", "Chrome", "Application", "chrome.exe"),
          path.join(process.env.ProgramFiles ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(process.env["ProgramFiles(x86)"] ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "Application", "msedge.exe"),
          path.join(process.env.ProgramFiles ?? "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"]
  const found = candidates.find((item) => item && existsSync(item))
  if (!found)
    throw new Error(
      "未找到 Chrome / Edge / Brave。请安装 Google Chrome，或设置环境变量 BULU_CHROME_PATH 指向浏览器可执行文件。",
    )
  return found
}

export function defaultProfileDir() {
  if (process.env.BULU_PROFILE_DIR?.trim()) return process.env.BULU_PROFILE_DIR.trim()
  const base =
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "bulu-browser")
      : path.join(os.homedir(), ".bulu-browser")
  return path.join(base, "profile")
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => server.close(() => resolve(true)))
    server.listen(port, "127.0.0.1")
  })
}

export async function findPort(start = 9333, end = 9433) {
  for (let port = start; port <= end; port++) if (await portAvailable(port)) return port
  throw new Error(`在 ${start}-${end} 范围内找不到可用的调试端口`)
}

export async function readCdpVersion(port, timeoutMs = 1500) {
  const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`CDP 探测失败: HTTP ${response.status}`)
  const body = await response.json()
  if (!body?.webSocketDebuggerUrl) throw new Error("CDP 未返回 webSocketDebuggerUrl")
  return { wsUrl: body.webSocketDebuggerUrl, browser: body.Browser }
}

export async function launchChrome(options = {}) {
  const executablePath = findChrome()
  const profileDir = options.profileDir ?? defaultProfileDir()
  mkdirSync(profileDir, { recursive: true })
  const marker = path.join(profileDir, ".bulu-profile")
  if (!existsSync(marker)) writeFileSync(marker, "bulu-browser-mcp\n", "utf8")
  const portFile = path.join(profileDir, ".bulu-port")

  // 上一次启动的实例可能还活着（profile 被锁时 Chrome 会把新命令转给旧实例后立即退出）。
  // 先尝试复用，避免“启动失败”的误判，也省掉一次冷启动。
  const remembered = readJsonSafe(portFile)
  if (typeof remembered?.port === "number") {
    try {
      const info = await readCdpVersion(remembered.port)
      return { child: null, reused: true, port: remembered.port, profileDir, executablePath, ...info }
    } catch {
      try {
        writeFileSync(portFile, "", "utf8")
      } catch {}
    }
  }

  // 电脑非正常关机、Chrome 被强杀后会残留 Singleton* 锁文件，导致下次启动失败。
  // 第一次失败后清锁重试一次，这条路径专门对付「重启电脑后打不开」。
  let lastError
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await startChrome(executablePath, profileDir, portFile, options)
    } catch (error) {
      lastError = error
      if (attempt === 2) break
      const cleared = clearStaleLocks(profileDir)
      process.stderr.write(`[bulu] 启动失败，清理 ${cleared} 个残留锁文件后重试：${error?.message ?? error}\n`)
      await new Promise((resolve) => setTimeout(resolve, 700))
    }
  }
  throw lastError
}

async function startChrome(executablePath, profileDir, portFile, options) {
  const port = options.port ?? (await findPort())
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    "--remote-allow-origins=*",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=DialMediaRouteProvider",
  ]
  if (options.headless) args.push("--headless=new")
  args.push("about:blank")

  // detached + unref：让 Chrome 独立于 MCP 进程存活。
  // 否则 WorkBuddy 结束会话杀掉 MCP 进程时，Chrome 会被一起带走，未落盘的登录态就丢了。
  const child = spawn(executablePath, args, { stdio: "ignore", windowsHide: false, detached: true })
  child.unref()
  let exitCode = null
  child.once("exit", (code) => {
    exitCode = code
  })
  child.once("error", (error) => {
    exitCode = -1
    process.stderr.write(`[bulu] chrome spawn error: ${error.message}\n`)
  })

  // 刚开机时 Chrome 冷启动 + 大 profile 可能要十几秒，给足 45 秒。
  const deadline = Date.now() + (options.timeoutMs ?? 45_000)
  let lastError = "Chrome 的 CDP 端点没有就绪"
  while (Date.now() < deadline) {
    if (exitCode !== null && exitCode !== 0) {
      killTree(child)
      throw new Error(`Chrome 启动后立即退出（code ${exitCode}），请检查浏览器是否可正常启动`)
    }
    try {
      const info = await readCdpVersion(port)
      writeFileSync(portFile, JSON.stringify({ port }), "utf8")
      return { child, reused: false, port, profileDir, executablePath, ...info }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
    // 新进程已经退出（code 0）说明 profile 被另一个实例占用，尝试接管那个实例
    if (exitCode === 0) {
      const takeover = await takeOverRunningInstance(profileDir, portFile, executablePath)
      if (takeover) return takeover
      throw new Error(
        `Chrome 以 code 0 立即退出，说明已有实例正在使用 profile「${profileDir}」。` +
          `请关闭该 Chrome 窗口后重试，或改用其他 BULU_PROFILE_DIR。`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  killTree(child)
  throw new Error(`等待 Chrome 调试端口超时：${lastError}`)
}

// 清理 Chrome 在 profile 里留下的单实例锁。只在启动失败后调用，
// 避免把活着的实例的锁删掉导致两个 Chrome 同时写一个 profile。
function clearStaleLocks(profileDir) {
  let cleared = 0
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket", "lockfile"]) {
    const file = path.join(profileDir, name)
    try {
      if (!existsSync(file)) {
        // SingletonLock 在 Windows 上可能是悬空符号链接，existsSync 会返回 false
        try {
          readlinkSync(file)
        } catch {
          continue
        }
      }
      unlinkSync(file)
      cleared++
    } catch {}
  }
  return cleared
}

// 并发场景：两个会话可能同时拉起 Chrome，输的那个应该接管赢的那个实例。
// 赢家写完 .bulu-port 需要一点时间，所以这里多轮重读，而不是只探一次。
async function takeOverRunningInstance(profileDir, portFile, executablePath) {
  for (let round = 0; round < 8; round++) {
    const remembered = readJsonSafe(portFile)
    const ports = new Set()
    if (typeof remembered?.port === "number") ports.add(remembered.port)
    if (round >= 4) for (let port = 9333; port <= 9343; port++) ports.add(port)
    for (const port of ports) {
      try {
        const info = await readCdpVersion(port, 600)
        writeFileSync(portFile, JSON.stringify({ port }), "utf8")
        return { child: null, reused: true, port, profileDir, executablePath, ...info }
      } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  return null
}

export function killTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true })
    } else {
      child.kill("SIGKILL")
    }
  } catch {}
}

// 等 Chrome 自己退出（此时它已经把 cookie / localStorage 落盘）。
// 超时才强杀，避免杀得太早导致登录态丢失。
export function waitExit(child, timeoutMs = 6000) {
  if (!child?.pid) return Promise.resolve(true)
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    let settled = false
    const done = (clean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(clean)
    }
    const timer = setTimeout(() => {
      killTree(child)
      done(false)
    }, timeoutMs)
    child.once("exit", () => done(true))
    child.once("error", () => done(true))
  })
}

export async function connectExternal(cdpUrl) {
  clearLoopbackProxy()
  const url = new URL(cdpUrl)
  const port = Number(url.port || 9222)
  const info = await readCdpVersion(port)
  return { child: null, port, profileDir: "(external)", executablePath: "(external)", ...info }
}

export function readJsonSafe(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch {
    return undefined
  }
}
