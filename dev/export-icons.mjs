import { chromium } from "playwright-core"
import { readFileSync, writeFileSync, mkdirSync } from "node:fs"

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
mkdirSync("assets/icons", { recursive: true })

const src = "data:image/png;base64," + readFileSync("assets/bulu-browser-icon-1024.png").toString("base64")
const browser = await chromium.launch({ headless: true, channel: "chrome" })
const page = await browser.newPage()

const results = await page.evaluate(
  async ({ src, sizes }) => {
    const img = new Image()
    img.src = src
    await img.decode()
    const out = []
    for (const size of sizes) {
      const canvas = document.createElement("canvas")
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext("2d")
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(img, 0, 0, size, size)
      out.push({ size, data: canvas.toDataURL("image/png").split(",")[1] })
    }
    return out
  },
  { src, sizes: SIZES },
)

function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(count, 4)
  const dirEntries = []
  let offset = 6 + 16 * count
  for (const item of entries) {
    const entry = Buffer.alloc(16)
    entry.writeUInt8(item.size >= 256 ? 0 : item.size, 0)
    entry.writeUInt8(item.size >= 256 ? 0 : item.size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(item.data.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += item.data.length
    dirEntries.push(entry)
  }
  return Buffer.concat([header, ...dirEntries, ...entries.map((i) => i.data)])
}

const buffers = results.map((item) => ({ size: item.size, data: Buffer.from(item.data, "base64") }))
for (const item of buffers) {
  writeFileSync(`assets/icons/icon-${item.size}.png`, item.data)
  console.log(`icon-${item.size}.png  ${(item.data.length / 1024).toFixed(1)}KB`)
}

const ico = buildIco(buffers.filter((i) => i.size <= 256))
writeFileSync("assets/icons/bulu-browser.ico", ico)
console.log(`bulu-browser.ico  ${(ico.length / 1024).toFixed(1)}KB  含 ${buffers.filter((i) => i.size <= 256).length} 个尺寸`)

await browser.close()
