import { spawn } from "node:child_process"

const child = spawn(process.execPath, ["src/index.mjs"], { stdio: ["pipe", "pipe", "ignore"] })
let buffer = ""
const pending = new Map()
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString()
  let i
  while ((i = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, i).trim()
    buffer = buffer.slice(i + 1)
    if (!line) continue
    const m = JSON.parse(line)
    const r = pending.get(m.id)
    if (r) { pending.delete(m.id); r(m) }
  }
})
let id = 1
const rpc = (method, params) => new Promise((res, rej) => {
  const my = id++
  pending.set(my, res)
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n")
  setTimeout(() => rej(new Error("timeout " + method)), 120_000)
})
const call = async (name, args) => {
  const r = await rpc("tools/call", { name, arguments: args })
  return { text: r.result?.content?.[0]?.text ?? "", isError: r.result?.isError }
}
const tokens = (n) => Math.round(n / 2.2)

await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } })
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")

const list = await rpc("tools/list", {})
console.log("工具数:", list.result.tools.length, "→", list.result.tools.map((t) => t.name).join(" "))

await call("browser_open", { url: "https://www.bing.com/search?q=workbuddy" })

const compact = await call("browser_snapshot", {})
const detailed = await call("browser_snapshot", { detailed: true, preserveRefs: true })
const pc = JSON.parse(compact.text)
const pd = JSON.parse(detailed.text)
console.log("\n=== snapshot 体积对比（同一页面）===")
console.log("紧凑版 :", compact.text.length, "字符 ≈", tokens(compact.text.length), "tokens")
console.log("详细版 :", detailed.text.length, "字符 ≈", tokens(detailed.text.length), "tokens")
console.log("节省   :", (100 - (compact.text.length / detailed.text.length) * 100).toFixed(1) + "%")
console.log("元素数 :", pc.refCount)
console.log("\n紧凑格式样例:")
console.log(pc.refs.split("\n").slice(0, 6).map((l) => "  " + l).join("\n"))

console.log("\n=== batch 测试（输入 + 回车，1 次调用完成 2 步）===")
const firstInput = pc.refs.split("\n").find((l) => /^\S+ (input|textarea)/.test(l))
const ref = firstInput?.split(" ")[0]
console.log("目标 ref:", ref, "→", firstInput?.slice(0, 70))
const searchBtn = pc.refs.split("\n").find((l) => /button type=submit|^\S+ button /.test(l))
const btnRef = searchBtn?.split(" ")[0]
console.log("搜索按钮:", btnRef, "→", searchBtn?.slice(0, 60))
const t0 = Date.now()
const batch = await call("browser_batch", {
  steps: [
    { ref, interaction: "type", text: "claude code" },
    { ref: btnRef, interaction: "click" },
  ],
  expect: { url: "q=claude" },
  expectTimeoutMs: 10000,
})
console.log("耗时:", Date.now() - t0, "ms")
const pb = JSON.parse(batch.text)
console.log("执行:", pb.executed + "/" + pb.total, "| 中断:", pb.stopped, "| expect:", JSON.stringify(pb.expect))
console.log("每步:", JSON.stringify(pb.results))

console.log("\n=== 下载列表 ===")
const d = await call("browser_downloads", {})
console.log(JSON.parse(d.text))

console.log("\n=== 安全校验（file:// 应被拒绝）===")
const bad = await call("browser_open", { url: "file:///C:/Windows/win.ini" })
console.log("isError:", bad.isError, "|", bad.text.slice(0, 90))

await call("browser_close", {})
child.stdin.end()
setTimeout(() => process.exit(0), 400)
