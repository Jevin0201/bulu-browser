# 开发辅助脚本

这些脚本用于生成图标、渲染预览和跑测试。**从项目根目录执行**（脚本里的路径都是相对项目根的）。

```powershell
cd "D:\network shared\bulu-browser"
node dev/render-showcase.mjs
```

## 图标相关

| 脚本 | 作用 |
|---|---|
| `render-showcase.mjs` | 渲染 `assets/showcase.png`（三版本对比图） |
| `render-final.mjs` | 输出 1024 白底圆角和透明底两版主图标 |
| `render-icon.mjs` | 输出 512 预览图和单张大图 |
| `export-icons.mjs` | 生成 16~512 全套 PNG + 打包 `bulu-browser.ico` |
| `crop-icon.mjs` | 裁掉布噜原图四周的透明留白（原图上下各留了 120px） |
| `crop-mascot.mjs` | 从全身像裁出上半身（62% 高度） |
| `fill-holes.mjs` | 填补贴纸轮廓上的透明破洞（连通区域算法） |
| `inspect-icon.mjs` | 读 PNG 的 alpha 包围盒和采样点颜色 |
| `analyze-right.mjs` | 扫描右侧列，定位灰色杂质 |
| `zoom-region.mjs` | 放大指定区域导出，用于目视检查细节 |

图标是纯 SVG + CSS 画的，源文件在 `assets/icon-preview.html` 和 `assets/showcase.html`。
要改配色、比例、位置，直接改这两个 HTML 里的 CSS，然后跑 `render-final.mjs` + `export-icons.mjs`。

## 测试脚本

| 脚本 | 验证什么 |
|---|---|
| `test-mcp.mjs` | MCP 协议全流程（initialize / tools/list / call） |
| `test-real.mjs` | 真实搜索流程（打开必应、输入、回车、读结果） |
| `test-v2.mjs` | 紧凑格式体积、batch、expect、安全校验 |
| `test-persist.mjs` | 优雅关闭后 cookie / localStorage 是否保留 |
| `test-reuse.mjs` | 跨进程复用同一 Chrome 实例 |
| `test-reboot.mjs` | 模拟重启电脑后的恢复 |
| `measure.mjs` | 测 snapshot 的字符数和 token 估算 |

## 踩过的坑（改图标时注意）

1. **布噜原图有透明留白**：`bulu-desktop-icon.png` 上下各留了约 120px 透明区，直接按整图尺寸定位会导致视觉重心偏移。必须先裁 bbox。
2. **头像素材有破洞**：`bulu-desktop-icon.png` 的贴纸轮廓右侧有不规则透明破洞，在白底上会显示成灰块。
3. **改用全身像**：`packages/app/src/assets/bulu/bulu-mascot-front.png` 轮廓完整，但太高，要裁上半身。
4. **裁切会切断**：半身裁切处用 `mask-image` 线性渐变淡出，否则是一条生硬直线。
