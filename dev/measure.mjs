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
const rpc = (method, params) => new Promise((res) => {
  const my = id++
  pending.set(my, res)
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: my, method, params }) + "\n")
})
const call = async (name, args) => {
  const r = await rpc("tools/call", { name, arguments: args })
  return { text: r.result?.content?.[0]?.text ?? "", isError: r.result?.isError }
}

await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "m", version: "1" } })
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")

const t0 = Date.now()
await call("browser_open", { url: "https://www.bing.com/search?q=workbuddy" })
const openMs = Date.now() - t0

const t1 = Date.now()
const s1 = await call("browser_snapshot", {})
const snapMs = Date.now() - t1
const p1 = JSON.parse(s1.text)

const t2 = Date.now()
const s2 = await call("browser_snapshot", {})
const snap2Ms = Date.now() - t2

console.log(JSON.stringify({
  openMs,
  snapMs,
  snap2Ms,
  第一次snapshot: {
    返回字符: s1.text.length,
    估算tokens: Math.round(s1.text.length / 2.2),
    正文长度: p1.text.length,
    ref数量: p1.refs.length,
    分页: p1.snapshot.complete ? "完整" : "未完成",
    总正文: p1.snapshot.totalTextChars,
    总ref: p1.snapshot.totalRefs,
  },
  第二次snapshot字符: s2.text.length,
  ref前缀: p1.refs.slice(0, 3).map((r) => r.ref),
}, null, 2))

await call("browser_close", {})
child.stdin.end()
setTimeout(() => process.exit(0), 300)
