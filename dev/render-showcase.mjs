import { chromium } from "playwright-core"
import path from "node:path"

const file = path.resolve("assets/showcase.html")
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage({ viewport: { width: 1180, height: 640 }, deviceScaleFactor: 1.6 })
await page.goto(`file:///${file.replace(/\\/g, "/")}`, { waitUntil: "networkidle" })
await page.waitForTimeout(700)
await page.screenshot({ path: "assets/showcase.png", fullPage: true })
await browser.close()
console.log("showcase saved")
