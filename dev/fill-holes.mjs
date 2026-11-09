import { chromium } from "playwright-core"
import { readFileSync, writeFileSync } from "node:fs"

const src = "data:image/png;base64," + readFileSync("assets/bulu-icon.png").toString("base64")
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
  const image = ctx.getImageData(0, 0, w, h)
  const d = image.data

  // 从画面四边向内泛洪，标记"外部透明区"。
  // 泛洪不到的透明像素就是被贴纸轮廓包住的破洞，需要补成白色。
  const outside = new Uint8Array(w * h)
  const stack = []
  const push = (x, y) => {
    const i = y * w + x
    if (outside[i]) return
    if (d[i * 4 + 3] > 10) return
    outside[i] = 1
    stack.push(i)
  }
  for (let x = 0; x < w; x++) {
    push(x, 0)
    push(x, h - 1)
  }
  for (let y = 0; y < h; y++) {
    push(0, y)
    push(w - 1, y)
  }
  while (stack.length) {
    const i = stack.pop()
    const x = i % w
    const y = (i - x) / w
    if (x > 0) push(x - 1, y)
    if (x < w - 1) push(x + 1, y)
    if (y > 0) push(x, y - 1)
    if (y < h - 1) push(x, y + 1)
  }

  let filled = 0
  for (let i = 0; i < w * h; i++) {
    if (!outside[i] && d[i * 4 + 3] <= 10) {
      d[i * 4] = 255
      d[i * 4 + 1] = 252
      d[i * 4 + 2] = 244
      d[i * 4 + 3] = 255
      filled++
    }
  }
  ctx.putImageData(image, 0, 0)
  return { data: canvas.toDataURL("image/png"), filled }
}, src)

writeFileSync("assets/bulu-icon-fixed.png", Buffer.from(out.data.split(",")[1], "base64"))
console.log("补洞像素数:", out.filled)
await browser.close()
