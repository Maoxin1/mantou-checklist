# mantou 个人定投清单

一个本地优先、可离线使用的个人长期行动清单生成器。日常只需要更新少量事实，就能自动汇总状态并生成一张 1080 × 1536 PNG，适合发布到微信群、社群或个人博客。

> 这里的“定投”不只指金钱，也指把时间持续投入认知、表达、身体与长期能力。

## 在线使用

- 主页生成器：<https://mantou-checklist.pages.dev/>
- 手机编辑器：<https://mantou-checklist.pages.dev/editor>

## 日常使用

V2 将日常输入收敛为 3 个字段：

1. 破界行动分钟（高质量阅读与批判性思维训练）
2. 今日训练：力量训练 / 激活 / 恢复 / 未训练
3. 日记完成状态

日期、当前阶段、当前阅读、投资阶段和本周交付物都属于低频设置，正常一天不需要修改。

系统会自动计算：

- 本周破界行动时间
- 本周力量训练次数
- 当前周状态
- 1080 × 1536 公开 PNG

目标是从打开 PWA 到生成图片，正常情况下不超过 15 秒。

## 它能做什么

- 记录每日 3 个最小事实并自动保存
- 自动汇总当前周阅读时长和力量训练次数
- 记录当前作息实验、投资阶段、阅读材料与本周交付物
- 实时生成与 mantou 博客一致的暖纸色“行动档案”图片
- 一键下载 1080 × 1536 PNG
- 首次联网安装后离线填写、预览和下载
- 导出 JSON 备份，并在另一台设备手动导入恢复
- 兼容旧版本地数据，自动迁移上一阶段默认字段
- 针对触控、窄屏和主流移动端浏览器设计

## 隐私与数据边界

这个项目没有后端数据库，也没有接入统计脚本。表单数据和自动保存内容默认只写入当前浏览器的 `localStorage`。

V2 只为当前周（本地时间周一至周日）保存极简日志：每天的破界行动分钟、训练状态和日记完成状态。记录与发布日期只能选择本周；选择其他周不会清空已有数据。同周切换可以补记，日记累计只随该日完成状态的实际变化增减。

新的一天会自动切到今天；若正在补记本周的其他日期，则继续停留在所选日期。自然进入新的一周时只保留新周日志，累计日记天数和阶段设置会保留，不建立历史档案。若需要历史明细，请在换周前导出备份。它不是健康数据库，也不会记录或公开具体血糖、症状、睡眠原始日志、仓位、金额等私人数据。

保存失败时会明确提示，当前填写仍留在页面内，PNG 和 JSON 备份下载不依赖本机存储可用。关闭或刷新前请先从本页的“本地数据管理”导出备份。

多个窗口同时使用时，无待保存修改的窗口会同步新数据；存在未保存修改或错过同步的旧窗口会停止覆盖，提示先导出该页备份再刷新。支持 Web Locks 的浏览器会串行检查和写入；较老浏览器使用最新值检查，极端同时写入仍建议只开一个编辑窗口。

导入会检查备份版本、字段类型、真实日历日期与周日志一致性。仍兼容旧版原始状态和 v1/v2 备份，保留现有 localStorage 键。旧版界面允许手动把累计日记设得低于本周已完成天数；加载此类旧本地数据时，会保留清单并将累计数校正到已完成天数，同时明确提示原值和校正值。只在之后保存时写回；导入文件仍需满足完整校验。导入前先保存一份本机恢复副本；若无法保存副本或新状态，则不改变原清单。最近一次导入前的副本可用“下载导入前备份”取回，下一次成功写入恢复副本时会替换它。清理浏览器数据也会移除该副本。导入其他周的备份时，只恢复累计日记和阶段设置，不恢复历史周明细。

建议定期打开“本地数据管理”，下载 JSON 备份。不要在公开 Issue、聊天群或截图中上传包含私人信息的备份文件。

## 移动端安装与离线使用

### Android

1. 使用 Chrome、三星浏览器或其他支持 PWA 的浏览器打开[手机编辑器](https://mantou-checklist.pages.dev/editor)。
2. 点击页面右上角的“安装”。
3. 如果没有弹出安装窗口，请打开浏览器菜单，选择“安装应用”或“添加到主屏幕”。

### iPhone / iPad

1. 使用 Safari 打开[手机编辑器](https://mantou-checklist.pages.dev/editor)。
2. 点击“分享”，选择“添加到主屏幕”。
3. 开启“作为 Web App 打开”，然后点击“添加”。

第一次加载和安装需要网络。成功打开一次后，即使暂时断网，仍可填写、预览、备份并下载图片。

## 本地运行

需要 Node.js 22+，推荐与 CI 一致的 Node.js 24。

```powershell
git clone https://github.com/Maoxin1/mantou-checklist.git
cd mantou-checklist
npm ci
npm run serve
```

打开：

- <http://127.0.0.1:4173/>
- <http://127.0.0.1:4173/editor>

常用命令：

```powershell
npm run check
npm test
npm run test:browser
npm run smoke:local
npm run build
```

## 默认配置

常用默认文案集中在 `config.json`：

- `diaryDay`：累计有效日记天数起点
- `bodyPhase` / `bodyMeta`：当前主实验与阶段补充
- `investmentPhase`：当前投资阶段
- `readingPhase`：当前阅读材料或阅读阶段
- `readingTargetMinutes`：每日破界行动参考目标
- `weeklyReadingTargetMinutes`：每周破界行动参考目标
- `weeklyStrengthTarget`：每周力量训练参考次数
- `nextResult*`：最多三个本周交付物及验收状态
- `motto`：长期口号

视觉颜色和手机布局位于 `styles.css`、`editor.css`；1080 × 1536 成图规则位于 `app.js`。

## Cloudflare Pages 部署

本项目保持 **Direct Upload + 本机手工发布**。GitHub Actions 只负责代码验证，不保存 Cloudflare 部署凭据。

首次在一台电脑部署，或 Wrangler 登录状态失效时：

```powershell
npx wrangler login --device
```

之后每次正式发布只需要：

```powershell
git pull
npm ci
npm run deploy
```

`npm run deploy` 会依次执行 JavaScript 检查、生产构建，并把 `dist/` 上传到现有的 `mantou-checklist` Cloudflare Pages 项目。

发布后如需额外核查正式站，可手动运行现有的 Production smoke workflow；日常不需要配置 `CLOUDFLARE_API_TOKEN` 或 `CLOUDFLARE_ACCOUNT_ID` 到 GitHub。

## 项目结构

```text
index.html / styles.css      桌面生成器
editor.html / editor.css    手机编辑器
app.js                      状态、周统计、Canvas 成图与 PWA 安装
editor.js                   手机切换与离线提示
backup.js                   桌面与手机共用备份和恢复
state.js                    日期、周日志和备份校验（无副作用）
sw.js                       离线缓存
config.json                 默认阶段与目标
scripts/                    构建、截图与自动化测试
```

## 许可证

[MIT License](./LICENSE)。


### 数据可靠性回归

`npm test` 覆盖状态与备份边界；`npm run test:browser` 构建后在隔离的本地端口运行 Chromium 数据回归；`npm run smoke:local` 使用同样的隔离服务器执行原有 PWA/离线/下载冒烟。浏览器脚本使用本机 Chrome/Chromium，可用 `CHROME_PATH` 指定路径，不使用真实浏览器资料或线上用户数据。WebKit、Firefox 与手机实机尚需单独验收。

### 博客视觉对齐

设计来源、真实浏览器验证范围与发布前注意事项见 [视觉对齐说明](docs/visual-alignment.md)。手机默认进入填写，方向键可切换填写与预览。
