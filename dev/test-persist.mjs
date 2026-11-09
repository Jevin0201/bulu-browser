import { BrowserSession } from "./src/driver.mjs"

const first = new BrowserSession()
await first.open("https://example.com")
const page = await first.page()
await page.evaluate(() => {
  document.cookie = "bulu_persist=hello; max-age=86400; path=/"
  localStorage.setItem("bulu_local", "world")
  sessionStorage.setItem("bulu_session", "temp")
})
await new Promise((r) => setTimeout(r, 1200))
const before = await page.evaluate(() => ({
  cookie: document.cookie,
  local: localStorage.getItem("bulu_local"),
}))
console.log("关闭前:", JSON.stringify(before))
await first.close()
console.log("已关闭（当前实现：taskkill /F 强杀）")
await new Promise((r) => setTimeout(r, 2500))

const second = new BrowserSession()
await second.open("https://example.com")
const p2 = await second.page()
const after = await p2.evaluate(() => ({
  cookie: document.cookie,
  local: localStorage.getItem("bulu_local"),
  session: sessionStorage.getItem("bulu_session"),
}))
console.log("重启后:", JSON.stringify(after))
console.log("\n结论:")
console.log("  cookie  :", after.cookie.includes("bulu_persist") ? "保留 ✓" : "丢失 ✗")
console.log("  localStg:", after.local === "world" ? "保留 ✓" : "丢失 ✗")
await second.close()
