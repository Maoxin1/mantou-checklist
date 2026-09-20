# mantou 个人定投清单

一个本地优先、可离线使用的个人长期行动清单生成器。日常只需要更新少量事实，就能自动汇总状态并生成一张 1080 × 1536 PNG，适合发布到微信群、社群或个人博客。

> 这里的“定投”不只指金钱，也指把时间持续投入认知、表达、身体与长期能力。

## 在线使用

- 主页生成器：<https://mantou-checklist.pages.dev/>
- 手机编辑器：<https://mantou-checklist.pages.dev/editor>

## 日常使用

V2 将日常输入收敛为 3 个字段：

1. 高质量阅读分钟
2. 今日训练：力量训练 / 激活 / 恢复 / 未训练
3. 日记完成状态

日期、当前阶段、当前阅读、投资阶段和本周交付物都属于低频设置，正常一天不需要修改。

系统会自动计算：

- 本周高质量阅读时间
- 本周力量训练次数
- 当前周状态
- 1080 × 1536 公开 PNG

目标是从打开 PWA 到生成图片，正常情况下不超过 15 秒。

## 它能做什么

- 记录每日 3 个最小事实并自动保存
- 自动汇总当前周阅读时长和力量训练次数
- 记录当前作息实验、投资阶段、阅读材料与本周交付物
- 实时生成“松柏档案”风格图片
- 一键下载 1080 × 1536 PNG
- 首次联网安装后离线填写、预览和下载
- 导出 JSON 备份，并在另一台设备手动导入恢复
- 兼容旧版本地数据，自动迁移上一阶段默认字段
- 针对触控、窄屏和主流移动端浏览器设计

## 隐私与数据边界

这个项目没有后端数据库，也没有接入统计脚本。表单数据和自动保存内容默认只写入当前浏览器的 `localStorage`。

V2 只为当前周保存极简日志：每天的阅读分钟、训练状态和日记完成状态。它不是健康数据库，也不会记录或公开具体血糖、症状、睡眠原始日志、仓位、金额等私人数据。

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

需要 Node.js 20+。

```powershell
git clone https://github.com/Maoxin1/mantou-checklist.git
cd mantou-checklist
npm install
npm run serve
```

打开：

- <http://127.0.0.1:4173/>
- <http://127.0.0.1:4173/editor>

常用命令：

```powershell
npm run check
npm run smoke
npm run build
```

## 默认配置

常用默认文案集中在 `config.json`：

- `diaryDay`：累计有效日记天数起点
- `bodyPhase` / `bodyMeta`：当前主实验与阶段补充
- `investmentPhase`：当前投资阶段
- `readingPhase`：当前阅读材料或阅读阶段
- `readingTargetMinutes`：每日阅读参考目标
- `weeklyReadingTargetMinutes`：每周高质量阅读参考目标
- `weeklyStrengthTarget`：每周力量训练参考次数
- `nextResult*`：最多三个本周交付物及验收状态
- `motto`：长期口号

视觉颜色和手机布局位于 `styles.css`、`editor.css`；1080 × 1536 成图规则位于 `app.js`。

## Cloudflare Pages 部署

项目使用与 `mantou-blog` 一致的自动发布路径：

1. Pull Request 与 `main` push 先运行 `Validate`；
2. 只有 `main` 上的 `Validate` 成功后，`Deploy Pages` 才构建并发布同一 commit；
3. 发布完成后自动运行正式站 smoke test；
4. 手动预览可在 `Deploy Pages` 中指定 `source_ref`。

`pages-deploy` Environment 需要：

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## 项目结构

```text
index.html / styles.css      桌面生成器
editor.html / editor.css    手机编辑器
app.js                      状态、周统计、Canvas 成图与 PWA 安装
editor.js                   手机切换、离线提示和备份恢复
sw.js                       离线缓存
config.json                 默认阶段与目标
scripts/                    构建、截图与自动化测试
```

## 许可证

[MIT License](./LICENSE)。
