import { chromium } from "playwright-core"

import { readFileSync } from "node:fs"
const src = "data:image/png;base64," + readFileSync("assets/bulu-icon.png").toString("base64")
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage()
await page.goto("about:blank")

const result = await page.evaluate(async (src) => {
  const img = new Image()
  img.src = src
  await img.decode()
  const canvas = document.createElement("canvas")
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext("2d")
  ctx.drawImage(img, 0, 0)
  const points = [
    [2, 2], [img.width - 3, 2], [2, img.height - 3], [img.width - 3, img.height - 3],
    [512, 512], [900, 880], [880, 980], [990, 700], [700, 950],
  ]
  const samples = points.map(([x, y]) => {
    const d = ctx.getImageData(x, y, 1, 1).data
    return { x, y, a: d[3], rgb: `${d[0]},${d[1]},${d[2]}` }
  })
  // 统计非透明像素的包围盒
  const all = ctx.getImageData(0, 0, img.width, img.height).data
  let minX = img.width, minY = img.height, maxX = 0, maxY = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (all[(y * img.width + x) * 4 + 3] > 12) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  return { size: [img.width, img.height], samples, bbox: { minX, minY, maxX, maxY } }
}, src)

console.log(JSON.stringify(result, null, 2))
await browser.close()
