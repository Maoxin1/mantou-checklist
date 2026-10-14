import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "./browser-path.mjs";
import { startTestServer } from "./test-server.mjs";

// Genuine Chromium evidence from isolated local fixture data. No production requests.
const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "test-output", "visual");
await mkdir(output, { recursive: true });
const server = await startTestServer(path.join(root, "dist"));
const report = [];
let browser;
let currentPage;
const config = { ...JSON.parse(await readFile(path.join(root, "config.json"), "utf8")), diaryDay: 42 };

async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
async function assertFits(page, label) {
  const result = await page.evaluate(() => ({ width: innerWidth, client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  assert.ok(result.scroll <= result.client + 1, `${label} horizontal overflow: ${JSON.stringify(result)}`);
  report.push({ check: label, ...result });
}
async function assertPNG(filename) {
  const bytes = await readFile(filename);
  assert.ok(bytes.length > 10_000, "PNG should contain a rendered poster");
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.subarray(12, 16).toString("ascii"), "IHDR");
  assert.equal(bytes.readUInt32BE(16), 1080);
  assert.equal(bytes.readUInt32BE(20), 1536);
}
async function assertExpandedFits(page, label) {
  const summaries = page.locator("details:not([open]) > summary");
  while (await summaries.count()) await summaries.first().click();
  await assertFits(page, label);
  const overflow = await page.locator("#checklist-form input:not([type=file]), #checklist-form textarea, #checklist-form select, #checklist-form button, #checklist-form summary").evaluateAll((nodes) => nodes.map((node) => ({ id: node.id, x: node.getBoundingClientRect().x, right: node.getBoundingClientRect().right })).filter((node) => node.x < -1 || node.right > innerWidth + 1));
  assert.deepEqual(overflow, [], label);
  await screenshot(page, label.replaceAll(" ", "-"));
}
async function open(route, width, height = 844) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: route === "/editor", isMobile: route === "/editor", timezoneId: "Asia/Shanghai", reducedMotion: "reduce", serviceWorkers: "block", acceptDownloads: true });
  const errors = [];
  context.on("page", (page) => page.on("pageerror", (error) => errors.push(error.message)));
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, server.url, "visual tests must remain local");
    if (url.pathname === "/config.json") return route.fulfill({ json: config });
    return route.continue();
  });
  const page = await context.newPage();
  currentPage = page;
  await page.clock.install({ time: new Date("2026-10-07T08:00:00Z") });
  await page.goto(`${server.url}${route}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#preview-forest")?.naturalWidth === 1080);
  await assertFits(page, `${route} ${width}px`);
  const images = await page.locator('img[src*="/identity/"]').evaluateAll((images) => images.map((image) => ({ complete: image.complete, width: image.naturalWidth })));
  assert.ok(images.length && images.every((image) => image.complete && image.width > 0), "identity images must load");
  return { context, page, errors };
}

try {
  browser = await chromium.launch({ executablePath: findChromeExecutable(), headless: true });
  const mobile = await open("/editor", 390);
  const { page } = mobile;
  assert.equal(await page.locator("#mobile-editor").getAttribute("data-view"), "form");
  assert.equal(await page.getByRole("tab", { selected: true }).getAttribute("id"), "tab-form");
  await page.locator("#tab-preview").tap();
  assert.equal(await page.locator("#mobile-editor").getAttribute("data-view"), "preview");
  await page.locator("#tab-form").tap();
  const touchDiaryBefore = await page.evaluate(() => window.checklistStorage.snapshot().diaryDay);
  await page.getByRole("switch").tap();
  assert.equal(await page.evaluate(() => window.checklistStorage.snapshot().diaryDone), true);
  await page.getByRole("switch").tap();
  assert.equal(await page.evaluate(() => window.checklistStorage.snapshot().diaryDay), touchDiaryBefore);
  const track = await page.locator("#reading-minutes").boundingBox();
  await page.touchscreen.tap(track.x + track.width * .3, track.y + track.height / 2);
  assert.ok(await page.evaluate(() => window.checklistStorage.snapshot().readingMinutes > 0));
  report.push({ check: "emulated touchscreen tab, diary toggle and slider tap", passed: true });
  await page.locator("#tab-form").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await page.locator("#mobile-editor").getAttribute("data-view"), "preview");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tab-preview");
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement.id), "panel-preview");
  await page.locator("#tab-preview").focus();
  await page.keyboard.press("Home");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tab-form");
  await page.keyboard.press("End");
  assert.equal(await page.evaluate(() => document.activeElement.id), "tab-preview");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#mobile-editor").getAttribute("data-view"), "form");

  const slider = page.getByRole("slider", { name: "阅读与思考分钟" });
  await slider.focus();
  await slider.press("Home");
  await slider.press("ArrowRight");
  assert.equal(await slider.inputValue(), "5");
  await slider.press("End");
  assert.equal(await slider.inputValue(), "180");
  for (let index = 0; index < 24; index++) await slider.press("ArrowLeft");
  assert.equal(await slider.inputValue(), "60");
  await page.locator("#training-status").selectOption("力量训练");
  await page.getByRole("switch").check();
  const before = await page.evaluate(() => window.checklistStorage.snapshot());
  for (let index = 0; index < 3; index++) {
    await page.locator("#tab-preview").click();
    await page.locator("#tab-preview").click();
    await page.locator("#tab-form").click();
  }
  assert.deepEqual(await page.evaluate(() => window.checklistStorage.snapshot()), before);
  const targets = await page.locator(".editor-tab, #reading-minutes, #training-status, #diary-done, #download-button, .mobile-header-actions a").evaluateAll((nodes) => nodes.map((node) => ({ id: node.id, height: node.getBoundingClientRect().height })));
  assert.ok(targets.every((target) => target.height >= 48), JSON.stringify(targets));
  await screenshot(page, "mobile-390-form");
  await page.screenshot({ path: path.join(output, "mobile-390-form-viewport.png"), fullPage: false });
  await page.locator("#tab-preview").click();
  await screenshot(page, "mobile-390-preview");
  await page.screenshot({ path: path.join(output, "mobile-390-preview-viewport.png"), fullPage: false });
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-button").click();
  const download = await downloadEvent;
  await download.saveAs(path.join(output, "poster-browser-export.png"));
  await assertPNG(path.join(output, "poster-browser-export.png"));
  assert.match(download.suggestedFilename(), /\.png$/);
  const png = await page.locator("#preview-forest").evaluate((image) => ({ width: image.naturalWidth, height: image.naturalHeight }));
  assert.deepEqual(png, { width: 1080, height: 1536 });
  report.push({ check: "mobile keyboard, repeated tabs, >=48px touch targets, live PNG download", passed: true, targets, png });
  await page.locator("#tab-form").click();
  await assertExpandedFits(page, "mobile-390-expanded");
  assert.equal(await page.locator("#investment-phase").count(), 0);
  assert.equal(await page.locator("#reading-phase").inputValue(), config.readingPhase);
  const revisedReading = "精读：《Beyond Feelings》\n略读：《The Craft of Research》· 第二遍";
  await page.locator("#reading-phase").fill(revisedReading);
  await page.evaluate(() => window.checklistStorage.save());
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await page.locator("#reading-phase").inputValue(), revisedReading, "multiline book names survive save and reload");
  assert.deepEqual(mobile.errors, []);
  await mobile.context.close();

  for (const width of [320, 760]) {
    const phone = await open("/editor", width);
    await screenshot(phone.page, `mobile-${width}-form`);
    await assertExpandedFits(phone.page, `mobile-${width}-expanded`);
    await phone.page.locator("#tab-preview").click();
    await assertFits(phone.page, `/editor preview ${width}px`);
    await screenshot(phone.page, `mobile-${width}-preview`);
    assert.deepEqual(phone.errors, []);
    await phone.context.close();
  }
  for (const width of [320, 390, 760, 1280]) {
    const desktop = await open("/", width, 1000);
    await desktop.page.evaluate(() => document.fonts.ready);
    const titleLines = await desktop.page.locator(".app-intro h1").evaluate((heading) => {
      const node = heading.firstChild;
      const lines = new Map();
      for (let i = 0; i < node.textContent.length; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        lines.set(top, (lines.get(top) || "") + node.textContent[i]);
      }
      return [...lines.values()].map((line) => line.trim()).filter(Boolean);
    });
    assert.equal((await desktop.page.locator(".app-intro h1").textContent()).trim(), "mantou 定投清单");
    assert.ok(!titleLines.some((line) => /^[\u3400-\u9fff]$/.test(line)), `orphaned title character at ${width}px: ${JSON.stringify(titleLines)}`);
    report.push({ check: `balanced brand title ${width}px`, lines: titleLines, passed: true });
    await screenshot(desktop.page, `desktop-${width}`);
    if (width < 1280) await assertExpandedFits(desktop.page, `desktop-${width}-expanded`);
    if (width === 1280) {
      await desktop.page.getByText("当前重点与阅读设置", { exact: true }).click();
      await desktop.page.getByText("本周交付物（可选）", { exact: true }).click();
      await desktop.page.locator("#body-phase").fill("长期阅读与实践的阶段性成果验证");
      await desktop.page.locator("#body-meta").fill("持续记录并根据真实反馈修正行动");
      await desktop.page.locator("#reading-phase").fill("精读：《Beyond Feelings：批判性思维的理解、练习与实际应用》\n略读：《The Craft of Research：从问题、证据到论证的研究方法》");
      for (const selector of ["#next-result", "#next-result-2", "#next-result-3"]) await desktop.page.locator(selector).fill("完成本周阅读笔记并交付一个可以验证和复用的作品");
      await desktop.page.locator("#next-result-date").selectOption("已通过");
      await desktop.page.waitForTimeout(400);
      const dataUrl = await desktop.page.evaluate(() => window.checklistExporter.toDataUrl());
      await writeFile(path.join(output, "poster-long-text-three-results.png"), Buffer.from(dataUrl.split(",")[1], "base64"));
      await assertPNG(path.join(output, "poster-long-text-three-results.png"));
      await assertFits(desktop.page, "expanded desktop form with long text");
    }
    assert.deepEqual(desktop.errors, []);
    await desktop.context.close();
  }
  console.log("[visual] responsive pages, keyboard tabs, touch targets, PNG and screenshots passed");
} catch (error) {
  report.push({ error: String(error) });
  if (currentPage && !currentPage.isClosed()) await screenshot(currentPage, "failure").catch(() => {});
  throw error;
} finally {
  await writeFile(path.join(output, "visual-report.json"), JSON.stringify(report, null, 2));
  await browser?.close();
  await server.close();
}
