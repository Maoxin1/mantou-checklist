import { chromium } from "playwright-core";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const projectDir = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(projectDir, "docs", "images");
const baseUrl = (process.env.CHECKLIST_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true
});

try {
  const page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  await page.goto(`${baseUrl}/editor.html?docs=1`, { waitUntil: "domcontentloaded" });
  await page.locator("#date").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));
  await page.screenshot({ path: path.join(outputDir, "editor-mobile-form.png"), fullPage: true });

  await page.locator("[data-editor-view='preview']").click();
  await page.locator(".mobile-preview-view").waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(outputDir, "editor-mobile-preview.png"), fullPage: true });

  const dataUrl = await page.evaluate(() => window.checklistExporter.toDataUrl());
  await writeFile(path.join(outputDir, "poster-example.png"), Buffer.from(dataUrl.split(",")[1], "base64"));
} finally {
  await browser.close();
}

console.log(`Documentation images written to ${outputDir}`);
