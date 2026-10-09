# mantou 定投清单：PWA 名称与图标

日期：2026-10-09。基线：GitHub main `f5a6f38e6a95b71b9655cadf8b1bd31d7693bd1d`，修改前所有源文件均与该版本 Git blob 校验一致。

## 范围

- 网页标题、主标题、manifest 的 name / short_name、iOS 主屏幕名称、安装提示与导出图片标题统一为 **mantou 定投清单**。
- PWA 192 / 512 图标直接复用 `identity/mantou-p1-walk.svg` 的原始路径，不重画角色，不改变比例。暖纸全不透明背景；整个原图边界位于 maskable 的中心 80% 直径安全圆内。
- 根页面说明手机使用与安装推荐 `/editor`。手机页原“主页”链接改称“桌面版”，目标仍为 `./`。
- SW 缓存版本升为 v29，仅为更新静态资源；未改动其安装、激活或缓存策略。

## 保持不变

- 根 manifest 仍为 `./manifest.webmanifest`，仍不设显式 id，start_url 和 scope 均为 `./`。
- 手机 manifest 仍为 `./editor.webmanifest`，id 和 start_url 均为 `./editor`，scope 为 `./`。
- 不合并两个既有安装身份，不迁移站点，不改 localStorage 键或备份格式。
- `state.js`、`backup.js`、`config.json`、`editor.js`、`identity.js` 和两份源 identity SVG 均逐字不变。
- 未增加导航目的地、表单字段、理财功能或外部服务。

## 图标再生成

正常环境执行 `npm run icons`，先生成 SVG，再由本机 Chromium 输出 PNG。

如果 Chromium 不能启动，可以只执行：

```sh
node scripts/generate-icons.mjs --svg-only
inkscape icons/icon-192.svg --export-type=png --export-filename=icons/icon-192.png
inkscape icons/icon-512.svg --export-type=png --export-filename=icons/icon-512.png
```

本轮 PNG 使用已安装的 Inkscape SVG 渲染器生成。无新增 npm 依赖，无 AI 图像生成。

## 验证结果与边界

- `npm run check`、`node --check scripts/generate-icons.mjs`、`npm test`（30 项）、`npm run build`、`git diff --check` 通过。
- 新增名称、安装引导、原有应用身份/数据键、P1 原路径、遮罩安全区、PNG 尺寸测试。
- PNG 像素检查：192×192 与 512×512，所有像素均不透明；角色墨色像素到中心的最远距离分别为 62.502 / 166.891，低于安全半径 76.8 / 204.8。已查看实际渲染图标。
- `npm run test:browser`、`npm run smoke:local`、`npm run test:visual` 均尝试运行，但当前执行器不允许 Chromium 建立启动所需的 socket，浏览器启动即失败；不是业务断言通过，也不能计作已完成真实浏览器验收。
- 支持的独立云浏览器不允许 file URL，也无法连接此执行器的本地 HTTP 端口；未绕过限制。
- 待可用浏览器环境或经批准的 CI 完成：320 / 390 / 1280 宽度、完整填写/预览/导出、安装提示重复点击、离线更新与真实设备主屏幕效果。iOS / Android 系统对既有图标与名称的刷新时机也需实机确认；不要通过清除浏览器数据来强制刷新。

本轮仅完成本地改动与可运行的验证，未推送、创建 PR、合并或部署。
