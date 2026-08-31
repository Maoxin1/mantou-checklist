import { chromium } from "playwright-core";
import { readFile } from "node:fs/promises";
import path from "node:path";

const projectDir = path.resolve(import.meta.dirname, "..");
const browser = await chromium.launch({
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  headless: true
});

try {
  for (const size of [192, 512]) {
    const svgPath = path.join(projectDir, "icons", `icon-${size}.svg`);
    const pngPath = path.join(projectDir, "icons", `icon-${size}.png`);
    const svg = await readFile(svgPath, "utf8");
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}svg{display:block}</style>${svg}`);
    await page.locator("svg").screenshot({ path: pngPath, omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
