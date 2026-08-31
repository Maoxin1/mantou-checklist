import { chromium } from "playwright-core";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const projectDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(projectDir, "test-output");
const baseUrl = (process.env.CHECKLIST_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
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

const mainPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const mainErrors = [];
mainPage.on("pageerror", (error) => mainErrors.push(error.message));
await mainPage.goto(`${baseUrl}/?v=15`, { waitUntil: "domcontentloaded", timeout: 15_000 });
await mainPage.locator("#date").waitFor({ state: "visible", timeout: 10_000 });
await mainPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));

if ((await mainPage.locator("#preview-forest").count()) !== 1) throw new Error("主页预览数量不是 1");
if (await mainPage.locator("[id*='phone'], [class*='phone-format']").count()) throw new Error("主页仍有手机尺寸输出");

await mainPage.locator("#date").fill("2026-09-20");
await mainPage.locator("#date").dispatchEvent("change");
const bodyPhase = await mainPage.locator("#body-phase").inputValue();
if (bodyPhase !== "精干强健计划") throw new Error(`阶段切换失败：${bodyPhase}`);

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

const editorPage = await browser.newPage({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
const editorErrors = [];
editorPage.on("pageerror", (error) => editorErrors.push(error.message));
await editorPage.goto(`${baseUrl}/editor.html?v=15`, { waitUntil: "domcontentloaded", timeout: 15_000 });
await editorPage.locator("#date").waitFor({ state: "visible", timeout: 10_000 });

const manifestHref = await editorPage.locator("link[rel='manifest']").getAttribute("href");
if (manifestHref !== "./editor.webmanifest") throw new Error(`编辑器安装清单异常：${manifestHref}`);
if (!(await editorPage.locator("#install-button").isVisible())) throw new Error("手机安装入口不可见");
const cdp = await editorPage.context().newCDPSession(editorPage);
const appManifest = await cdp.send("Page.getAppManifest");
if (appManifest.errors?.length) throw new Error(`PWA 清单错误：${appManifest.errors.map((item) => item.message).join(" | ")}`);

if (!(await editorPage.locator(".mobile-form-view").isVisible())) throw new Error("手机编辑器未默认显示填写页");
if (await editorPage.locator(".mobile-preview-view").isVisible()) throw new Error("手机编辑器默认错误显示预览页");
await editorPage.screenshot({ path: path.join(outputDir, "editor-mobile-form.png"), fullPage: true });

const touchHeights = await editorPage.locator(".editor-tab, #date, #gym-minus, #gym-plus, #download-button").evaluateAll((nodes) =>
  nodes.map((node) => Math.round(node.getBoundingClientRect().height))
);
if (touchHeights.some((height) => height < 48)) throw new Error(`触控目标过小：${touchHeights.join(", ")}`);

const initialDiaryDays = Number(await editorPage.locator("#diary-day").inputValue());
if (!(await editorPage.locator("#diary-done").isChecked())) await editorPage.locator("#diary-done").check();
await editorPage.locator("#gym-count").fill("3");
await editorPage.locator("#gym-count").dispatchEvent("input");
await editorPage.waitForTimeout(450);
const savedState = await editorPage.evaluate(() => JSON.parse(localStorage.getItem("personal-investment-checklist:v1")));
if (!savedState?.diaryDone || savedState.gymCount !== 3) throw new Error("手机编辑器自动保存失败");
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
await editorPage.waitForTimeout(350);
editorPage.once("dialog", (dialog) => dialog.accept());
await editorPage.locator("#backup-file").setInputFiles(backupPath);
await editorPage.waitForFunction(() => document.querySelector("#gym-count")?.value === "3");
if ((await editorPage.locator("#gym-count").inputValue()) !== "3") throw new Error("备份导入恢复失败");

await editorPage.locator("[data-editor-view='preview']").click();
await editorPage.locator(".mobile-preview-view").waitFor({ state: "visible" });
if (await editorPage.locator(".mobile-form-view").isVisible()) throw new Error("手机编辑器视图切换失败");
await editorPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));
const previewSize = await editorPage.locator("#preview-forest").evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
if (previewSize.width !== 1080 || previewSize.height !== 1536) throw new Error(`成图尺寸异常：${previewSize.width}×${previewSize.height}`);
await editorPage.screenshot({ path: path.join(outputDir, "editor-mobile-preview.png"), fullPage: true });

const overflow = await editorPage.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
if (overflow > 1) throw new Error(`手机编辑器横向溢出：${overflow}px`);

if (!(await waitForServiceWorker(editorPage))) throw new Error("手机编辑器 Service Worker 未就绪");

await editorPage.reload({ waitUntil: "domcontentloaded" });
await editorPage.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
await editorPage.evaluate(() => {
  Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => false });
  window.dispatchEvent(new Event("offline"));
});
await editorPage.waitForFunction(() => document.querySelector("#connection-status")?.classList.contains("offline"));
await editorPage.context().setOffline(true);
await editorPage.reload({ waitUntil: "domcontentloaded", timeout: 10_000 });
await editorPage.locator("#date").waitFor({ state: "visible" });
await editorPage.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));

const editorDownloadEvent = editorPage.waitForEvent("download", { timeout: 10_000 });
await editorPage.locator("#download-button").click();
const editorDownload = await editorDownloadEvent;
if (!editorDownload.suggestedFilename().endsWith(".png")) throw new Error("离线 PNG 下载失败");
await editorPage.context().setOffline(false);
if (editorErrors.length) throw new Error(`手机编辑器错误：${editorErrors.join(" | ")}`);
console.log("[smoke] mobile editor ready");

console.log(JSON.stringify({
  bodyPhase,
  mainPreviewCount: 1,
  exportPath,
  exportBytes: exportStats.size,
  touchHeights,
  savedGymCount: savedState.gymCount,
  mobileOverflow: overflow,
  previewSize,
  manifestHref,
  manifestErrors: appManifest.errors?.length || 0,
  backupBytes: (await stat(backupPath)).size,
  offlineReload: true
}, null, 2));

await browser.close();
