import { chromium } from "playwright-core"
import { readFileSync, writeFileSync } from "node:fs"
const src = "data:image/png;base64," + readFileSync("assets/bulu-icon.png").toString("base64")
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage()
const out = await page.evaluate(async (src) => {
  const img = new Image(); img.src = src; await img.decode()
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height
  const ctx = c.getContext("2d"); ctx.drawImage(img, 0, 0)
  const x0 = 800, y0 = 300, w = 224, h = 480
  const z = document.createElement("canvas"); z.width = w * 3; z.height = h * 3
  const zctx = z.getContext("2d")
  zctx.fillStyle = "#2b2b2b"; zctx.fillRect(0, 0, z.width, z.height)
  zctx.imageSmoothingEnabled = false
  zctx.drawImage(c, x0, y0, w, h, 0, 0, w * 3, h * 3)
  return z.toDataURL("image/png")
}, src)
writeFileSync("assets/zoom-right.png", Buffer.from(out.split(",")[1], "base64"))
console.log("saved")
await browser.close()
