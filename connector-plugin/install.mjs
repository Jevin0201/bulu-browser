// 把 bulu-browser 注册成一个「带图标的本地连接器插件」。
// 只做两件可回滚的事：
//   1) 把 connector-plugin 目录复制到 ~/.workbuddy/plugins/marketplaces/bulu-local
//   2) 在 plugins/known_marketplaces.json 里新增一条 bulu-local 记录
// 不改官方市场、不动 ~/.workbuddy/mcp.json、不改 installed_plugins.json。
//
//   node install.mjs             注册
//   node install.mjs --uninstall 回滚（恢复备份并删除目录）

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const pluginsDir = path.join(homedir(), ".workbuddy", "plugins")
const knownFile = path.join(pluginsDir, "known_marketplaces.json")
const backupFile = `${knownFile}.bak-bulu`
const targetDir = path.join(pluginsDir, "marketplaces", "bulu-local")
const mcpFile = path.join(homedir(), ".workbuddy", "mcp.json")
const mcpBackup = `${mcpFile}.bak-bulu`
const uninstall = process.argv.includes("--uninstall")

function fail(message) {
  console.error(`[bulu] ${message}`)
  process.exit(1)
}

if (!existsSync(knownFile)) fail(`找不到 ${knownFile}`)

if (uninstall) {
  if (existsSync(backupFile)) {
    writeFileSync(knownFile, readFileSync(backupFile))
    rmSync(backupFile)
    console.log("[bulu] 已恢复 known_marketplaces.json 备份")
  } else {
    const known = JSON.parse(readFileSync(knownFile, "utf8"))
    delete known["bulu-local"]
    writeFileSync(knownFile, `${JSON.stringify(known, null, 1)}\n`, "utf8")
    console.log("[bulu] 已移除 bulu-local 记录")
  }
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  // 恢复裸配置，保证回滚后工具不丢
  if (existsSync(mcpBackup)) {
    writeFileSync(mcpFile, readFileSync(mcpBackup))
    rmSync(mcpBackup)
    console.log("[bulu] 已恢复 mcp.json 原配置")
  }
  console.log("[bulu] 已删除本地市场目录，重启 WorkBuddy 后生效")
  process.exit(0)
}

// 备份一次即可，避免重复运行时把「已注册状态」当成原始状态备份
if (!existsSync(backupFile)) {
  writeFileSync(backupFile, readFileSync(knownFile))
  console.log("[bulu] 已备份 known_marketplaces.json → .bak-bulu")
}

mkdirSync(path.dirname(targetDir), { recursive: true })
rmSync(targetDir, { recursive: true, force: true })
cpSync(here, targetDir, {
  recursive: true,
  filter: (src) => !src.split(/[\\/]/).includes("install.mjs"),
})

const known = JSON.parse(readFileSync(knownFile, "utf8"))
known["bulu-local"] = {
  manifestName: "bulu-local",
  type: "directory",
  source: { source: "directory", path: targetDir },
  installLocation: targetDir,
  description: "布噜浏览器本地连接器市场",
  lastUpdated: new Date().toISOString(),
  autoUpdate: false,
}
writeFileSync(knownFile, `${JSON.stringify(known, null, 1)}\n`, "utf8")

// 插件包里的 MCP 与 mcp.json 里的裸配置同名，同时存在会注册出两个 bulu-browser。
// 备份后移除裸配置；回滚时会从备份恢复。
let legacyRemoved = false
if (existsSync(mcpFile)) {
  const raw = readFileSync(mcpFile, "utf8")
  const mcp = JSON.parse(raw)
  if (mcp.mcpServers?.["bulu-browser"]) {
    if (!existsSync(mcpBackup)) writeFileSync(mcpBackup, raw)
    delete mcp.mcpServers["bulu-browser"]
    writeFileSync(mcpFile, `${JSON.stringify(mcp, null, 2)}\n`, "utf8")
    legacyRemoved = true
  }
}

const icon = path.join(targetDir, "connectors", "bulu-browser", "ai.workbuddy", "assets", "icon.png")
console.log("")
console.log("[bulu] 注册完成")
console.log(`  本地市场: ${targetDir}`)
console.log(`  图标文件: ${existsSync(icon) ? "已就位 (512x512)" : "缺失！"}`)
console.log(`  裸配置重名: ${legacyRemoved ? "已从 mcp.json 移除（备份 .bak-bulu）" : "无需处理"}`)
console.log("")
console.log("下一步：完全退出并重启 WorkBuddy → 专家·技能·连接器 → 连接器")
console.log("       在列表里找到「布噜浏览器」并安装 / 信任。")
console.log("")
console.log("回滚：node install.mjs --uninstall（会恢复索引与 mcp.json）")
