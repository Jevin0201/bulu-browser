import { chromium } from "playwright-core"
import path from "node:path"

const file = path.resolve("assets/icon-preview.html")
const browser = await chromium.launch({ headless: true, channel: "chrome" })

const page = await browser.newPage({ viewport: { width: 620, height: 640 }, deviceScaleFactor: 2 })
await page.goto(`file:///${file.replace(/\\/g, "/")}`, { waitUntil: "networkidle" })
await page.waitForTimeout(700)

const rounded = await page.$("#rounded")
await rounded.screenshot({ path: "assets/bulu-browser-icon-1024.png" })

const plain = await page.$("#plain")
await plain.screenshot({ path: "assets/bulu-browser-transparent-1024.png", omitBackground: true })

await browser.close()
console.log("1024 版本已输出")
