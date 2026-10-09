import { chromium } from "playwright-core";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { findChromeExecutable } from "./browser-path.mjs";

const projectDir = path.resolve(import.meta.dirname, "..");
// Reuse the exact P1 paths, without redrawing or stretching the character.
// The full 313 × 571 source box, at 0.6 scale, fits inside the maskable
// central 80%-diameter circle: hypot(313 * .3, 571 * .3) < 512 * .4.
const character = await readFile(path.join(projectDir, "identity", "mantou-p1-walk.svg"), "utf8");
const paths = character.match(/<path\b[^>]*\/>/g).join("\n");
for (const size of [192, 512]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">\n  <rect width="512" height="512" fill="#fffaf1"/>\n  <g transform="translate(162.1 84.7) scale(0.6)">${paths}</g>\n</svg>\n`;
  await writeFile(path.join(projectDir, "icons", `icon-${size}.svg`), svg);
}
// Useful for deterministic SVG checks or rasterization by another SVG renderer.
if (!process.argv.includes("--svg-only")) {
  const browser = await chromium.launch({ executablePath: findChromeExecutable(), headless: true });
  try {
    for (const size of [192, 512]) {
      const svg = await readFile(path.join(projectDir, "icons", `icon-${size}.svg`), "utf8");
      const page = await browser.newPage({ viewport: { width: size, height: size } });
      await page.setContent(`<style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden}svg{display:block}</style>${svg}`);
      await page.locator("svg").screenshot({ path: path.join(projectDir, "icons", `icon-${size}.png`), omitBackground: true });
      await page.close();
    }
  } finally { await browser.close(); }
}
