import { chromium } from "playwright-core"
import { readFileSync, writeFileSync } from "node:fs"

const src = "data:image/png;base64," + readFileSync("assets/bulu-mascot.png").toString("base64")
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage()

const out = await page.evaluate(async (src) => {
  const img = new Image()
  img.src = src
  await img.decode()
  const w = img.width
  const h = img.height
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img, 0, 0)
  const d = ctx.getImageData(0, 0, w, h).data

  let minX = w, minY = h, maxX = 0, maxY = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }

  // 只取上半身（头 + 手 + 胸），保留竖向 62%，横向跟着收紧
  const fullH = maxY - minY
  const keepH = Math.round(fullH * 0.62)
  const x0 = minX
  const y0 = minY
  const cw = maxX - minX
  const ch = keepH

  const out = document.createElement("canvas")
  out.width = cw
  out.height = ch
  out.getContext("2d").drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch)
  return { data: out.toDataURL("image/png"), w: cw, h: ch }
}, src)

writeFileSync("assets/bulu-mascot-upper.png", Buffer.from(out.data.split(",")[1], "base64"))
console.log(`上半身: ${out.w}x${out.h}  比例 ${(out.w / out.h).toFixed(2)}`)
await browser.close()
