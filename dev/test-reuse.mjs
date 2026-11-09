import { BrowserSession } from "./src/driver.mjs"

const step = process.argv[2]

if (step === "1") {
  const s = new BrowserSession()
  await s.open("https://example.com")
  const page = await s.page()
  await page.evaluate(() => {
    document.cookie = "bulu_reuse=yes; max-age=86400; path=/"
    localStorage.setItem("bulu_reuse_local", "kept")
  })
  await new Promise((r) => setTimeout(r, 1000))
  console.log("[步骤1] 已设置 cookie 和 localStorage，端口:", s.launch?.port)
  console.log("[步骤1] 模拟 MCP 进程被直接终止（不调用 close）")
  process.exit(0)
}

if (step === "2") {
  const s = new BrowserSession()
  await s.ensure()
  console.log("[步骤2] 复用已有实例:", s.launch?.reused === true ? "是 ✓" : "否（新启动了）")
  console.log("[步骤2] 端口:", s.launch?.port)
  await s.open("https://example.com")
  const page = await s.page()
  const data = await page.evaluate(() => ({
    cookie: document.cookie,
    local: localStorage.getItem("bulu_reuse_local"),
  }))
  console.log("[步骤2] cookie:", data.cookie.includes("bulu_reuse") ? "还在 ✓" : "丢了 ✗")
  console.log("[步骤2] localStorage:", data.local === "kept" ? "还在 ✓" : "丢了 ✗")
  await s.close()
}
