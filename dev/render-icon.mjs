import { chromium } from "playwright-core"
import path from "node:path"

const file = path.resolve("assets/icon-preview.html")
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage({ viewport: { width: 1180, height: 620 }, deviceScaleFactor: 1 })
await page.goto(`file:///${file.replace(/\\/g, "/")}`, { waitUntil: "networkidle" })
await page.waitForTimeout(500)

const plain = await page.$("#plain")
await plain.screenshot({ path: "assets/icon-plain.png", omitBackground: true })

const rounded = await page.$("#rounded")
await rounded.screenshot({ path: "assets/icon-rounded.png" })

/* 单独输出一张大图（透明底），用于实际注册 */
const big = await browser.newPage({ viewport: { width: 520, height: 520 }, deviceScaleFactor: 2 })
await big.goto(`file:///${file.replace(/\\/g, "/")}`, { waitUntil: "networkidle" })
await big.evaluate(() => {
  document.body.style.padding = "0"
  document.body.style.gap = "0"
  document.querySelector("#rounded").remove()
  const el = document.querySelector("#plain")
  el.style.margin = "0"
  document.body.appendChild(el)
})
await big.waitForTimeout(300)
const el = await big.$("#plain")
await el.screenshot({ path: "assets/bulu-browser-1024.png", omitBackground: true })

await browser.close()
console.log("done")
