import { BrowserSession } from "./src/driver.mjs"

const step = process.argv[2]

if (step === "set") {
  const s = new BrowserSession()
  await s.open("https://example.com")
  const page = await s.page()
  await page.evaluate(() => {
    document.cookie = "bulu_reboot=yes; max-age=604800; path=/"
    localStorage.setItem("bulu_reboot_local", "kept")
  })
  await new Promise((r) => setTimeout(r, 1200))
  console.log("[set] 数据已写入，端口:", s.launch?.port, "| profile:", s.launch?.profileDir)
  console.log("[set] 进程退出，Chrome 保持存活（detached）")
  process.exit(0)
}

if (step === "verify") {
  const t0 = Date.now()
  const s = new BrowserSession()
  await s.ensure()
  console.log("[verify] 启动耗时:", Date.now() - t0, "ms")
  console.log("[verify] 复用已有实例:", s.launch?.reused === true ? "是" : "否（重新拉起）")
  console.log("[verify] 端口:", s.launch?.port)
  await s.open("https://example.com")
  const page = await s.page()
  const data = await page.evaluate(() => ({
    cookie: document.cookie,
    local: localStorage.getItem("bulu_reboot_local"),
  }))
  console.log("[verify] cookie:", data.cookie.includes("bulu_reboot") ? "在 ✓" : "没了 ✗")
  console.log("[verify] localStorage:", data.local === "kept" ? "在 ✓" : "没了 ✗")
  await s.close()
}
