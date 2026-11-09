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
    setTimeout(() => reject(new Error(`timeout: ${method}`)), 90_000)
  })
}

const init = await rpc("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "probe", version: "1" } })
console.log("initialize:", JSON.stringify(init.result?.serverInfo), init.result?.protocolVersion)
child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")

const list = await rpc("tools/list", {})
console.log("tools:", list.result.tools.length, list.result.tools.map((t) => t.name).join(", "))

async function call(name, args) {
  const response = await rpc("tools/call", { name, arguments: args })
  const text = response.result?.content?.[0]?.text ?? ""
  return { isError: response.result?.isError, text }
}

const opened = await call("browser_open", { url: "https://example.com" })
console.log("open:", opened.text.slice(0, 120).replace(/\n/g, " "))

const snap = await call("browser_snapshot", {})
const parsed = JSON.parse(snap.text)
console.log("snapshot title:", parsed.title, "| text chars:", parsed.text.length, "| refs:", parsed.refs.length)
console.log("snapshot text:", JSON.stringify(parsed.text.slice(0, 80)))
console.log("snapshot meta:", JSON.stringify(parsed.snapshot))

const act = await call("browser_act", { ref: parsed.refs[0]?.ref, interaction: "click" })
console.log("act:", act.isError ? act.text.slice(0, 120) : JSON.parse(act.text).changes.note)

const tabs = await call("browser_tabs", {})
console.log("tabs:", JSON.parse(tabs.text).tabs.length)

await call("browser_close", {})
console.log("closed")
child.stdin.end()
setTimeout(() => process.exit(0), 500)
