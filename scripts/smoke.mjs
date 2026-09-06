import { chromium } from "playwright-core";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { findChromeExecutable } from "./browser-path.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(projectDir, "test-output");
const baseUrl = (process.env.CHECKLIST_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: findChromeExecutable(),
  headless: true
});
console.log("[smoke] browser ready");

async function waitForServiceWorker(page) {
  return page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return false;
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      if (await navigator.serviceWorker.getRegistration()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  });
}

async function testInstallHelp(userAgent, expectedText) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent });
  await context.addInitScript(() => {
    const addEventListener = window.addEventListener.bind(window);
    window.addEventListener = (type, listener, options) => {
      if (type === "beforeinstallprompt") return;
      addEventListener(type, listener, options);
    };
  });
  const page = await context.newPage();
  await page.goto(`${baseUrl}/editor`, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator("#install-button").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));
  if ((await page.locator("link[rel='apple-touch-icon']").getAttribute("href")) !== "./icons/icon-192.png") {
    throw new Error("Apple Touch Icon 配置异常");
  }
  await page.locator("#install-button").click();
  await page.waitForFunction((text) => document.querySelector("#toast")?.textContent.includes(text), expectedText);
  await context.close();
}

const mainPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const mainErrors = [];
mainPage.on("pageerror", (error) => mainErrors.push(error.message));
await mainPage.goto(`${baseUrl}/?v=16`, { waitUntil: "domcontentloaded", timeout: 15_000 });
await mainPage.locator("#date").waitFor({ state: "visible", timeout: 10_000 });
await mainPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));

if ((await mainPage.locator("#preview-forest").count()) !== 1) throw new Error("主页预览数量不是 1");
if (await mainPage.locator("[id*='phone'], [class*='phone-format']").count()) throw new Error("主页仍有手机尺寸输出");
if ((await mainPage.locator("#reading-phase").inputValue()) !== "Beyond Feelings · W1") {
  throw new Error("主页认知训练阶段默认值异常");
}

await mainPage.locator("#next-result").fill("顺延成果测试");
await mainPage.locator("#next-result-2").fill("顺延成果测试二");
await mainPage.locator("#next-result-3").fill("顺延成果测试三");
await mainPage.locator("#date").fill("2026-09-20");
await mainPage.locator("#date").dispatchEvent("change");
const bodyPhase = await mainPage.locator("#body-phase").inputValue();
if (bodyPhase !== "精干强健计划") throw new Error(`阶段切换失败：${bodyPhase}`);
if ((await mainPage.locator("#next-result").inputValue()) !== "顺延成果测试") {
  throw new Error("切换日期错误覆盖了本周成果");
}
if ((await mainPage.locator("#next-result-2").inputValue()) !== "顺延成果测试二" ||
    (await mainPage.locator("#next-result-3").inputValue()) !== "顺延成果测试三") {
  throw new Error("切换日期错误覆盖了新增交付物");
}

const exportPath = path.join(outputDir, "exported-forest.png");
const dataUrl = await mainPage.evaluate(() => window.checklistExporter.toDataUrl());
await writeFile(exportPath, Buffer.from(dataUrl.split(",")[1], "base64"));
const exportStats = await stat(exportPath);
if (exportStats.size < 10_000) throw new Error(`主页导出异常：${exportStats.size} bytes`);

const mainDownloadEvent = mainPage.waitForEvent("download", { timeout: 10_000 });
await mainPage.locator("#download-button").click();
const mainDownload = await mainDownloadEvent;
if (!mainDownload.suggestedFilename().endsWith(".png")) throw new Error("主页下载文件名异常");
if (!(await waitForServiceWorker(mainPage))) throw new Error("主页 Service Worker 未就绪");
if (mainErrors.length) throw new Error(`主页错误：${mainErrors.join(" | ")}`);
console.log("[smoke] main generator ready");

const editorContext = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
const editorPage = await editorContext.newPage();
const editorErrors = [];
editorPage.on("pageerror", (error) => editorErrors.push(error.message));
await editorPage.goto(`${baseUrl}/editor`, { waitUntil: "domcontentloaded", timeout: 15_000 });
await editorPage.locator(".mobile-preview-view").waitFor({ state: "visible", timeout: 10_000 });
await editorPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));

const manifestHref = await editorPage.locator("link[rel='manifest']").getAttribute("href");
if (manifestHref !== "./editor.webmanifest") throw new Error(`编辑器安装清单异常：${manifestHref}`);
if (!(await editorPage.locator("#install-button").isVisible())) throw new Error("手机安装入口不可见");
const cdp = await editorPage.context().newCDPSession(editorPage);
const appManifest = await cdp.send("Page.getAppManifest");
if (appManifest.errors?.length) throw new Error(`PWA 清单错误：${appManifest.errors.map((item) => item.message).join(" | ")}`);
const appManifestData = JSON.parse(appManifest.data);
if (appManifestData.id !== "./editor") throw new Error(`PWA 应用 ID 异常：${appManifestData.id}`);
if (appManifestData.start_url !== "./editor") {
  throw new Error(`PWA 启动入口异常：${appManifestData.start_url}`);
}
if (appManifestData.display !== "standalone") {
  throw new Error(`PWA 未配置为无地址栏独立运行：${appManifestData.display}`);
}

if (await editorPage.locator(".mobile-form-view").isVisible()) throw new Error("手机编辑器默认错误显示填写页");
if (!(await editorPage.locator(".mobile-preview-view").isVisible())) throw new Error("手机编辑器未默认显示预览页");
await editorPage.screenshot({ path: path.join(outputDir, "editor-mobile-preview.png"), fullPage: true });

await editorPage.locator("[data-editor-view='form']").click();
await editorPage.locator(".mobile-form-view").waitFor({ state: "visible" });
await editorPage.screenshot({ path: path.join(outputDir, "editor-mobile-form.png"), fullPage: true });

const touchHeights = await editorPage.locator(".editor-tab, #date, #gym-minus, #gym-plus, #download-button").evaluateAll((nodes) =>
  nodes.map((node) => Math.round(node.getBoundingClientRect().height))
);
if (touchHeights.some((height) => height < 48)) throw new Error(`触控目标过小：${touchHeights.join(", ")}`);

await editorPage.evaluate(() => {
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = weekStart.getDay() || 7;
  weekStart.setDate(weekStart.getDate() - day + 1);
  const weekKey = [
    weekStart.getFullYear(),
    String(weekStart.getMonth() + 1).padStart(2, "0"),
    String(weekStart.getDate()).padStart(2, "0")
  ].join("-");
  localStorage.setItem("personal-investment-checklist:v1", JSON.stringify({
    date: today,
    bodyPhase: "旧身体阶段",
    bodyMeta: "旧阶段补充",
    investmentPhase: "旧投资阶段",
    diaryDone: true,
    diaryDay: 88,
    englishStatus: "✓ 已完成",
    gymCount: 2,
    weekKey,
    nextResult: "旧版自定义成果",
    nextResultDate: "2026.9.19",
    motto: "旧口号"
  }));
});
await editorPage.reload({ waitUntil: "domcontentloaded" });
await editorPage.locator("[data-editor-view='form']").click();
await editorPage.locator(".mobile-form-view").waitFor({ state: "visible" });
await editorPage.locator("details").first().evaluate((details) => { details.open = true; });
if ((await editorPage.locator("#body-phase").inputValue()) !== "旧身体阶段") throw new Error("旧身体阶段迁移失败");
if ((await editorPage.locator("#investment-phase").inputValue()) !== "旧投资阶段") throw new Error("旧投资阶段迁移失败");
if ((await editorPage.locator("#diary-day").inputValue()) !== "88") throw new Error("旧日记数据迁移失败");
if ((await editorPage.locator("#gym-count").inputValue()) !== "2") throw new Error("旧健身数据迁移失败");
if ((await editorPage.locator("#reading-phase").inputValue()) !== "Beyond Feelings · W1") {
  throw new Error("旧数据未补齐认知训练阶段");
}
if ((await editorPage.locator("#english-status").inputValue()) !== "今日未开始") {
  throw new Error("旧英语状态被错误解释为认知训练完成");
}
if ((await editorPage.locator("#next-result").inputValue()) !== "旧版自定义成果") {
  throw new Error("旧成果名称迁移失败");
}
if ((await editorPage.locator("#next-result-date").inputValue()) !== "待验收") {
  throw new Error("旧成果日期未归一化为待验收");
}
if ((await editorPage.locator("#next-result-2").inputValue()) !== "" ||
    (await editorPage.locator("#next-result-3").inputValue()) !== "") {
  throw new Error("旧数据未正确补齐空白交付物");
}
if ((await editorPage.locator("#next-result-date-2").inputValue()) !== "待验收" ||
    (await editorPage.locator("#next-result-date-3").inputValue()) !== "待验收") {
  throw new Error("旧数据未正确补齐新增验收状态");
}

await editorPage.locator("#reading-phase").fill("Beyond Feelings · W3");
await editorPage.locator("#reading-phase").dispatchEvent("input");
await editorPage.locator("#english-status").selectOption("今日完成");
await editorPage.locator("#next-result").fill("跨周顺延成果");
await editorPage.locator("#next-result").dispatchEvent("input");
await editorPage.locator("#next-result-date").selectOption("已通过");
await editorPage.locator("#next-result-2").fill("第二交付物");
await editorPage.locator("#next-result-date-2").selectOption("待验收");
await editorPage.locator("#next-result-3").fill("第三交付物");
await editorPage.locator("#next-result-date-3").selectOption("已通过");
await editorPage.waitForTimeout(450);
await editorPage.evaluate(() => {
  const state = JSON.parse(localStorage.getItem("personal-investment-checklist:v1"));
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  state.date = [
    yesterday.getFullYear(),
    String(yesterday.getMonth() + 1).padStart(2, "0"),
    String(yesterday.getDate()).padStart(2, "0")
  ].join("-");
  state.weekKey = "2000-01-03";
  localStorage.setItem("personal-investment-checklist:v1", JSON.stringify(state));
});
await editorPage.reload({ waitUntil: "domcontentloaded" });
await editorPage.locator("[data-editor-view='form']").click();
await editorPage.locator(".mobile-form-view").waitFor({ state: "visible" });
await editorPage.locator("details").first().evaluate((details) => { details.open = true; });
if ((await editorPage.locator("#english-status").inputValue()) !== "今日未开始") {
  throw new Error("认知训练状态没有按天重置");
}
if ((await editorPage.locator("#reading-phase").inputValue()) !== "Beyond Feelings · W3") {
  throw new Error("认知训练阶段没有跨日期保留");
}
if ((await editorPage.locator("#next-result").inputValue()) !== "跨周顺延成果") {
  throw new Error("本周成果没有跨周顺延");
}
if ((await editorPage.locator("#next-result-date").inputValue()) !== "已通过") {
  throw new Error("验收状态没有跨周保留");
}
if ((await editorPage.locator("#next-result-2").inputValue()) !== "第二交付物" ||
    (await editorPage.locator("#next-result-date-2").inputValue()) !== "待验收" ||
    (await editorPage.locator("#next-result-3").inputValue()) !== "第三交付物" ||
    (await editorPage.locator("#next-result-date-3").inputValue()) !== "已通过") {
  throw new Error("新增交付物没有跨周保留");
}
if ((await editorPage.locator("#gym-count").inputValue()) !== "0") throw new Error("健身周计数没有按周重置");

const initialDiaryDays = Number(await editorPage.locator("#diary-day").inputValue());
if (!(await editorPage.locator("#diary-done").isChecked())) await editorPage.locator("#diary-done").check();
await editorPage.locator("#gym-count").fill("3");
await editorPage.locator("#gym-count").dispatchEvent("input");
await editorPage.locator("#english-status").selectOption("休息日");
await editorPage.locator("#next-result-date").selectOption("已通过");
await editorPage.waitForTimeout(450);
const savedState = await editorPage.evaluate(() => JSON.parse(localStorage.getItem("personal-investment-checklist:v1")));
if (!savedState?.diaryDone || savedState.gymCount !== 3) throw new Error("手机编辑器自动保存失败");
if (savedState.readingPhase !== "Beyond Feelings · W3" || savedState.englishStatus !== "休息日") {
  throw new Error("认知训练状态自动保存失败");
}
if (savedState.nextResultDate !== "已通过") throw new Error("验收状态自动保存失败");
if (savedState.nextResult2 !== "第二交付物" || savedState.nextResultDate2 !== "待验收" ||
    savedState.nextResult3 !== "第三交付物" || savedState.nextResultDate3 !== "已通过") {
  throw new Error("新增交付物自动保存失败");
}
if (Number(await editorPage.locator("#diary-day").inputValue()) < initialDiaryDays) throw new Error("日记累计天数异常");

const backupPath = path.join(outputDir, "checklist-backup.json");
await editorPage.getByText("本地数据管理", { exact: true }).click();
const backupDownloadEvent = editorPage.waitForEvent("download", { timeout: 10_000 });
await editorPage.locator("#export-backup").click();
const backupDownload = await backupDownloadEvent;
if (!backupDownload.suggestedFilename().endsWith(".json")) throw new Error("备份导出文件名异常");
await backupDownload.saveAs(backupPath);
if ((await stat(backupPath)).size < 100) throw new Error("备份文件内容异常");

await editorPage.locator("#gym-count").fill("1");
await editorPage.locator("#gym-count").dispatchEvent("input");
await editorPage.locator("#english-status").selectOption("今日未开始");
await editorPage.locator("#next-result-date").selectOption("待验收");
await editorPage.locator("#next-result-2").fill("已修改的第二项");
await editorPage.locator("#next-result-date-3").selectOption("待验收");
await editorPage.waitForTimeout(350);
editorPage.once("dialog", (dialog) => dialog.accept());
await editorPage.locator("#backup-file").setInputFiles(backupPath);
await editorPage.waitForFunction(() => document.querySelector("#gym-count")?.value === "3");
if ((await editorPage.locator("#gym-count").inputValue()) !== "3") throw new Error("备份导入恢复失败");
if ((await editorPage.locator("#english-status").inputValue()) !== "休息日") throw new Error("认知训练状态备份恢复失败");
if ((await editorPage.locator("#next-result-date").inputValue()) !== "已通过") throw new Error("验收状态备份恢复失败");
if ((await editorPage.locator("#next-result-2").inputValue()) !== "第二交付物" ||
    (await editorPage.locator("#next-result-date-3").inputValue()) !== "已通过") {
  throw new Error("新增交付物备份恢复失败");
}

await editorPage.locator("[data-editor-view='preview']").click();
await editorPage.locator(".mobile-preview-view").waitFor({ state: "visible" });
if (await editorPage.locator(".mobile-form-view").isVisible()) throw new Error("手机编辑器视图切换失败");
await editorPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));
const previewSize = await editorPage.locator("#preview-forest").evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
if (previewSize.width !== 1080 || previewSize.height !== 1536) throw new Error(`成图尺寸异常：${previewSize.width}×${previewSize.height}`);
const posterText = await editorPage.evaluate(() => {
  const text = [];
  const originalFillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function capture(value, ...args) {
    text.push(String(value));
    return originalFillText.call(this, value, ...args);
  };
  try {
    window.checklistExporter.toDataUrl();
  } finally {
    CanvasRenderingContext2D.prototype.fillText = originalFillText;
  }
  return text;
});
for (const expectedText of [
  "Beyond Feelings · W3",
  "认知训练",
  "休息日",
  "本周交付物",
  "跨周顺延成果",
  "第二交付物",
  "第三交付物",
  "待验收",
  "已通过"
]) {
  if (!posterText.includes(expectedText)) throw new Error(`成图缺少关键信息：${expectedText}`);
}
const conditionalPosterText = await editorPage.evaluate(() => {
  const second = document.querySelector("#next-result-2");
  const third = document.querySelector("#next-result-3");
  const originalSecond = second.value;
  const originalThird = third.value;

  function capturePosterText() {
    const text = [];
    const originalFillText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function capture(value, ...args) {
      text.push(String(value));
      return originalFillText.call(this, value, ...args);
    };
    try {
      window.checklistExporter.toDataUrl();
    } finally {
      CanvasRenderingContext2D.prototype.fillText = originalFillText;
    }
    return text;
  }

  third.value = "";
  const two = capturePosterText();
  second.value = "";
  const one = capturePosterText();
  second.value = originalSecond;
  third.value = originalThird;
  return { one, two };
});
if (!conditionalPosterText.two.includes("01") || !conditionalPosterText.two.includes("02") ||
    conditionalPosterText.two.includes("03") || conditionalPosterText.two.includes("待填写")) {
  throw new Error("两个交付物的条件渲染异常");
}
if (!conditionalPosterText.one.includes("01") || conditionalPosterText.one.includes("02") ||
    conditionalPosterText.one.includes("03") || conditionalPosterText.one.includes("待填写")) {
  throw new Error("单个交付物仍显示了空白行");
}
await editorPage.screenshot({ path: path.join(outputDir, "editor-mobile-preview.png"), fullPage: true });

const overflow = await editorPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) throw new Error(`手机编辑器横向溢出：${overflow}px`);

if (!(await waitForServiceWorker(editorPage))) throw new Error("手机编辑器 Service Worker 未就绪");
await editorPage.waitForFunction(() => document.querySelector("#connection-status")?.textContent.includes("已可离线使用"));

await editorPage.reload({ waitUntil: "domcontentloaded" });
await editorPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
await editorPage.evaluate(() => {
  Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false });
  window.dispatchEvent(new Event("offline"));
});
await editorPage.waitForFunction(() => document.querySelector("#connection-status")?.classList.contains("offline"));
await editorPage.context().setOffline(true);
await editorPage.reload({ waitUntil: "domcontentloaded", timeout: 10_000 });
await editorPage.locator("#date").waitFor({ state: "attached" });
await editorPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));

const editorDownloadEvent = editorPage.waitForEvent("download", { timeout: 10_000 });
await editorPage.locator("#download-button").click();
const editorDownload = await editorDownloadEvent;
if (!editorDownload.suggestedFilename().endsWith(".png")) throw new Error("离线 PNG 下载失败");
if (editorErrors.length) throw new Error(`手机编辑器错误：${editorErrors.join(" | ")}`);

const installedStartUrl = new URL(appManifestData.start_url, `${baseUrl}/editor`).href;
await editorPage.close();
const offlineLaunchPage = await editorContext.newPage();
await offlineLaunchPage.goto(installedStartUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
await offlineLaunchPage.locator("#date").waitFor({ state: "attached" });
await offlineLaunchPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));
const offlineLaunchDownloadEvent = offlineLaunchPage.waitForEvent("download", { timeout: 10_000 });
await offlineLaunchPage.locator("#download-button").click();
const offlineLaunchDownload = await offlineLaunchDownloadEvent;
if (!offlineLaunchDownload.suggestedFilename().endsWith(".png")) throw new Error("桌面图标离线冷启动后 PNG 下载失败");
await editorContext.setOffline(false);
console.log("[smoke] mobile editor ready");

await testInstallHelp(
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0 Mobile Safari/537.36",
  "浏览器菜单"
);
await testInstallHelp(
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  "Safari"
);
console.log("[smoke] cross-platform install help ready");

console.log(JSON.stringify({
  bodyPhase,
  mainPreviewCount: 1,
  exportPath,
  exportBytes: exportStats.size,
  touchHeights,
  savedGymCount: savedState.gymCount,
  readingPhase: savedState.readingPhase,
  readingStatus: savedState.englishStatus,
  acceptanceStatus: savedState.nextResultDate,
  deliverables: [savedState.nextResult, savedState.nextResult2, savedState.nextResult3],
  mobileOverflow: overflow,
  previewSize,
  manifestHref,
  manifestId: appManifestData.id,
  manifestStartUrl: appManifestData.start_url,
  manifestDisplay: appManifestData.display,
  manifestErrors: appManifest.errors?.length || 0,
  backupBytes: (await stat(backupPath)).size,
  offlineReload: true,
  offlineColdLaunch: true,
  installHelp: ["android", "ios"]
}, null, 2));

await browser.close();
