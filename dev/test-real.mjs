import { spawn } from "node:child_process"

const child = spawn(process.execPath, ["src/index.mjs"], { stdio: ["pipe", "pipe", "inherit"] })
let buffer = ""
const pending = new Map()
child.stdout.on("data", (chunk) => {
  buffer += chunk.toString()
  let index
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    const message = JSON.parse(line)
    const resolve = pending.get(message.id)
    if (resolve) {
      pending.delete(message.id)
      resolve(message)
    }
  }
})
let nextId = 1
function rpc(method, params) {
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n")
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 120_000)
  })
}
async function call(name, args) {
  const response = await rpc("tools/call", { name, arguments: args })
  return { isError: response.result?.isError, text: response.result?.content?.[0]?.text ?? "" }
}
await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } })
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")

const t0 = Date.now()
const opened = await call("browser_open", { url: "https://www.bing.com" })
console.log("[open]", Date.now() - t0, "ms", JSON.parse(opened.text).title)

const snap = await call("browser_snapshot", { maxRefs: 40 })
const page = JSON.parse(snap.text)
console.log("[snapshot]", Date.now() - t0, "ms refs:", page.refs.length, "text:", page.text.length)
const box = page.refs.find((r) => r.tag === "textarea" || (r.tag === "input" && (r.type === "search" || r.type === "text")))
console.log("[search box]", JSON.stringify(box))

if (box) {
  const typed = await call("browser_act", { ref: box.ref, interaction: "type", text: "WorkBuddy" })
  console.log("[type]", typed.isError ? typed.text.slice(0, 150) : JSON.parse(typed.text).changes.note)
  const enter = await call("browser_press_key", { key: "Enter" })
  console.log("[enter]", enter.isError ? enter.text.slice(0, 150) : JSON.parse(enter.text).changes.note)
  await new Promise((r) => setTimeout(r, 2500))
  const after = await call("browser_snapshot", { maxRefs: 20, maxTextChars: 1500 })
  const p2 = JSON.parse(after.text)
  console.log("[after search]", p2.title, "|", p2.url.slice(0, 80))
  console.log("[after text]", JSON.stringify(p2.text.slice(0, 100)))
}

const shot = await call("browser_screenshot", {})
console.log("[screenshot]", shot.isError ? shot.text.slice(0, 100) : JSON.parse(shot.text).path)
const net = await call("browser_network", { action: "list", limit: 5 })
console.log("[network]", JSON.parse(net.text).total, "records")

await call("browser_close", {})
child.stdin.end()
setTimeout(() => process.exit(0), 500)
