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

async function setRangeValue(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

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
  await page.locator("#install-button").click();
  await page.waitForFunction((text) => document.querySelector("#toast")?.textContent.includes(text), expectedText);
  await context.close();
}

const mainPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const mainErrors = [];
mainPage.on("pageerror", (error) => mainErrors.push(error.message));
await mainPage.goto(`${baseUrl}/?v=21`, { waitUntil: "domcontentloaded", timeout: 15_000 });
await mainPage.locator("#reading-minutes").waitFor({ state: "visible", timeout: 10_000 });
await mainPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));

await mainPage.locator("details").first().evaluate((details) => { details.open = true; });
if ((await mainPage.locator("#body-phase").inputValue()) !== "作息重构实验 V1") throw new Error("当前阶段默认值异常");
if ((await mainPage.locator("#reading-phase").inputValue()) !== "认知类书籍") throw new Error("当前阅读默认值异常");

await setRangeValue(mainPage, "#reading-minutes", 100);
await mainPage.locator("#training-status").selectOption("力量训练");
if (!(await mainPage.locator("#diary-done").isChecked())) await mainPage.locator("#diary-done").check();
await mainPage.waitForTimeout(450);

const savedMain = await mainPage.evaluate(() => JSON.parse(localStorage.getItem("personal-investment-checklist:v1")));
if (savedMain.readingMinutes !== 100) throw new Error("阅读分钟自动保存失败");
if ((await mainPage.locator("#reading-minutes-value").textContent()) !== "100 分钟") throw new Error("阅读滑块数值显示未同步");
if (savedMain.trainingStatus !== "力量训练") throw new Error("训练状态自动保存失败");
if (!savedMain.weekLog?.[savedMain.date]) throw new Error("本周自动日志未保存");

const posterText = await mainPage.evaluate(() => {
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
for (const expectedText of ["作息重构实验 V1 · 5:00–8:00", "100 分钟 · 目标 ≥ 90", "力量训练", "本周进度", "完成14天 V1 验收"]) {
  if (!posterText.includes(expectedText)) throw new Error(`成图缺少关键信息：${expectedText}`);
}

const exportPath = path.join(outputDir, "exported-v2.png");
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
const cdp = await editorPage.context().newCDPSession(editorPage);
const appManifest = await cdp.send("Page.getAppManifest");
if (appManifest.errors?.length) throw new Error(`PWA 清单错误：${appManifest.errors.map((item) => item.message).join(" | ")}`);
const appManifestData = JSON.parse(appManifest.data);
if (appManifestData.id !== "./editor" || appManifestData.start_url !== "./editor" || appManifestData.display !== "standalone") {
  throw new Error("PWA 安装入口配置异常");
}

await editorPage.locator("[data-editor-view='form']").click();
await editorPage.locator(".mobile-form-view").waitFor({ state: "visible" });
const touchHeights = await editorPage.locator(".editor-tab, #reading-minutes, #training-status, #download-button").evaluateAll((nodes) =>
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
  localStorage.setItem("personal-investment-checklist:v1", JSON.stringify({
    date: today,
    bodyPhase: "精干强健计划",
    bodyMeta: "持续期",
    investmentPhase: "旧投资阶段",
    readingPhase: "Beyond Feelings · W1",
    diaryDone: false,
    diaryDay: 88,
    englishStatus: "✓ 已完成",
    gymCount: 2,
    nextResult: "批判性判断框架 v0.1",
    nextResultDate: "待验收",
    motto: "旧口号"
  }));
});
await editorPage.reload({ waitUntil: "domcontentloaded" });
await editorPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));
await editorPage.locator("[data-editor-view='form']").click();
await editorPage.locator("details").first().evaluate((details) => { details.open = true; });
if ((await editorPage.locator("#body-phase").inputValue()) !== "作息重构实验 V1") throw new Error("旧身体阶段未迁移");
if ((await editorPage.locator("#reading-phase").inputValue()) !== "认知类书籍") throw new Error("旧阅读阶段未迁移");
if ((await editorPage.locator("#reading-minutes").inputValue()) !== "0") throw new Error("旧数据未补齐阅读分钟");
if ((await editorPage.locator("#training-status").inputValue()) !== "未训练") throw new Error("旧数据未补齐训练状态");
if ((await editorPage.locator("#diary-day").inputValue()) !== "88") throw new Error("旧日记累计数据迁移失败");

await setRangeValue(editorPage, "#reading-minutes", 90);
await editorPage.locator("#training-status").selectOption("力量训练");
if (!(await editorPage.locator("#diary-done").isChecked())) await editorPage.locator("#diary-done").check();
await editorPage.waitForTimeout(450);
const savedState = await editorPage.evaluate(() => JSON.parse(localStorage.getItem("personal-investment-checklist:v1")));
if (savedState.readingMinutes !== 90 || savedState.trainingStatus !== "力量训练" || !savedState.diaryDone) {
  throw new Error("手机编辑器 V2 自动保存失败");
}

const backupPath = path.join(outputDir, "checklist-backup-v2.json");
await editorPage.getByText("本地数据管理", { exact: true }).click();
const backupDownloadEvent = editorPage.waitForEvent("download", { timeout: 10_000 });
await editorPage.locator("#export-backup").click();
const backupDownload = await backupDownloadEvent;
await backupDownload.saveAs(backupPath);
if ((await stat(backupPath)).size < 100) throw new Error("备份文件内容异常");

await setRangeValue(editorPage, "#reading-minutes", 5);
await editorPage.locator("#training-status").selectOption("恢复");
await editorPage.waitForTimeout(350);
editorPage.once("dialog", (dialog) => dialog.accept());
await editorPage.locator("#backup-file").setInputFiles(backupPath);
await editorPage.waitForFunction(() => document.querySelector("#reading-minutes")?.value === "90");
if ((await editorPage.locator("#training-status").inputValue()) !== "力量训练") throw new Error("备份恢复训练状态失败");

await editorPage.locator("[data-editor-view='preview']").click();
const previewSize = await editorPage.locator("#preview-forest").evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
if (previewSize.width !== 1080 || previewSize.height !== 1536) throw new Error(`成图尺寸异常：${previewSize.width}×${previewSize.height}`);
const overflow = await editorPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) throw new Error(`手机编辑器横向溢出：${overflow}px`);

if (!(await waitForServiceWorker(editorPage))) throw new Error("手机编辑器 Service Worker 未就绪");
await editorPage.reload({ waitUntil: "domcontentloaded" });
await editorPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
await editorPage.context().setOffline(true);
await editorPage.reload({ waitUntil: "domcontentloaded", timeout: 10_000 });
await editorPage.locator("#reading-minutes").waitFor({ state: "attached" });
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
await offlineLaunchPage.locator("#reading-minutes").waitFor({ state: "attached" });
await offlineLaunchPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));
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

console.log(JSON.stringify({
  exportBytes: exportStats.size,
  readingMinutes: savedState.readingMinutes,
  trainingStatus: savedState.trainingStatus,
  diaryDone: savedState.diaryDone,
  weekLogEntries: Object.keys(savedState.weekLog || {}).length,
  mobileOverflow: overflow,
  previewSize,
  backupBytes: (await stat(backupPath)).size,
  offlineReload: true,
  offlineColdLaunch: true
}, null, 2));

await browser.close();
