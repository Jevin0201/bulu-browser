import { chromium } from "playwright-core"
import { readFileSync, writeFileSync } from "node:fs"

const src = "data:image/png;base64," + readFileSync("assets/bulu-icon-fixed.png").toString("base64")
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage()

const out = await page.evaluate(async (src) => {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data

  let minX = img.width, minY = img.height, maxX = 0, maxY = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (data[(y * img.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const pad = 4
  const x0 = Math.max(0, minX - pad)
  const y0 = Math.max(0, minY - pad)
  const w = Math.min(img.width - x0, maxX - minX + pad * 2)
  const h = Math.min(img.height - y0, maxY - minY + pad * 2)

  const cropped = document.createElement("canvas")
  cropped.width = w
  cropped.height = h
  cropped.getContext("2d").drawImage(canvas, x0, y0, w, h, 0, 0, w, h)
  return { data: cropped.toDataURL("image/png"), w, h }
}, src)

writeFileSync("assets/bulu-icon-trimmed.png", Buffer.from(out.data.split(",")[1], "base64"))
console.log(`裁剪后: ${out.w}x${out.h} (原 1024x1024)`)
await browser.close()
