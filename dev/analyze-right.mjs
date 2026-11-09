import { chromium } from "playwright-core"
import { readFileSync } from "node:fs"

const src = "data:image/png;base64," + readFileSync("assets/bulu-icon.png").toString("base64")
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage()

const result = await page.evaluate(async (src) => {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data

  const cols = []
  for (let x = 820; x < img.width; x++) {
    let opaque = 0
    let gray = 0
    let warm = 0
    for (let y = 0; y < img.height; y++) {
      const i = (y * img.width + x) * 4
      const a = data[i + 3]
      if (a < 20) continue
      opaque++
      const r = data[i], g = data[i + 1], b = data[i + 2]
      const max = Math.max(r, g, b)
      const min = Math.min(r, g, b)
      const sat = max === 0 ? 0 : (max - min) / max
      if (sat < 0.12 && max > 120 && max < 235) gray++
      if (r >= g && g >= b && max > 180) warm++
    }
    if (opaque > 0) cols.push({ x, opaque, gray, warm, grayRatio: +(gray / opaque).toFixed(2) })
  }
  return cols
}, src)

const suspicious = result.filter((c) => c.grayRatio > 0.35 && c.gray > 8)
console.log("可疑灰色列（前 20）:", JSON.stringify(suspicious.slice(0, 20), null, 1))
console.log("最右暖色列:", Math.max(...result.filter((c) => c.warm > c.gray).map((c) => c.x)))
await browser.close()
