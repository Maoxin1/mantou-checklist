import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { STORAGE_KEY, RECOVERY_KEY, BACKUP_FORMAT } from "../state.js";
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const brand = "mantou 定投清单";

test("both installed names match while existing app identities and entry routes stay unchanged", () => {
  for (const [filename, start, id] of [["manifest.webmanifest", "./", undefined], ["editor.webmanifest", "./editor", "./editor"]]) {
    const manifest = JSON.parse(read(filename));
    assert.equal(manifest.name, brand);
    assert.equal(manifest.short_name, brand);
    assert.equal(manifest.start_url, start);
    assert.equal(manifest.scope, "./");
    assert.equal(manifest.id, id);
    if (id === undefined) assert.equal(Object.hasOwn(manifest, "id"), false);
    assert.deepEqual(manifest.icons.map(({ src, purpose }) => [src, purpose]), [["./icons/icon-192.png", "any maskable"], ["./icons/icon-512.png", "any maskable"]]);
  }
  for (const [page, manifest] of [["index.html", "manifest.webmanifest"], ["editor.html", "editor.webmanifest"]]) {
    const html = read(page);
    assert.ok(html.includes(`<title>${brand}</title>`));
    assert.ok(html.includes(`<h1>${brand}</h1>`));
    assert.ok(html.includes(`name="application-name" content="${brand}"`));
    assert.ok(html.includes(`name="apple-mobile-web-app-title" content="${brand}"`));
    assert.ok(html.includes(`rel="manifest" href="./${manifest}"`));
  }
  assert.equal(STORAGE_KEY, "personal-investment-checklist:v1");
  assert.equal(RECOVERY_KEY, `${STORAGE_KEY}:recovery`);
  assert.equal(BACKUP_FORMAT, "mantou-personal-investment-checklist");
});

test("install guidance keeps the mobile recommendation and each platform's existing path", () => {
  assert.match(read("index.html"), /手机使用与安装，推荐先打开<a href="\.\/editor">手机编辑器<\/a>/);
  assert.match(read("editor.html"), /href="\.\/" aria-label="打开 mantou 定投清单桌面版">桌面版/);
  const source = read("app.js").match(/function getInstallHelpMessage\(\) \{[\s\S]*?\n\}/)[0];
  const message = (navigator) => vm.runInNewContext(`${source}; getInstallHelpMessage()`, { navigator });
  for (const navigator of [{ userAgent: "iPhone" }, { userAgent: "Mozilla", platform: "MacIntel", maxTouchPoints: 5 }]) {
    assert.match(message(navigator), /Safari.*分享.*添加到主屏幕/);
    assert.ok(message(navigator).includes(brand));
  }
  assert.match(message({ userAgent: "Android" }), /浏览器菜单.*安装应用.*添加到主屏幕/);
  assert.ok(message({ userAgent: "Android" }).includes(brand));
});

test("both PWA sizes reuse the exact P1 vector within a full opaque maskable safe zone", () => {
  const originals = [...read("identity/mantou-p1-walk.svg").matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  for (const size of [192, 512]) {
    const svg = read(`icons/icon-${size}.svg`);
    assert.deepEqual([...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]), originals);
    assert.ok(svg.includes(`width="${size}" height="${size}" viewBox="0 0 512 512"`));
    assert.ok(svg.includes('<rect width="512" height="512" fill="#fffaf1"/>'));
    assert.ok(svg.includes('transform="translate(162.1 84.7) scale(0.6)"'));
    // The entire source rectangle, not just the silhouette, stays in the 80% circle.
    assert.ok(Math.hypot(313 * .3, 571 * .3) < 512 * .4);
    assert.equal(162.1 + 313 * .3, 256);
    assert.equal(84.7 + 571 * .3, 256);
    const png = readFileSync(new URL(`../icons/icon-${size}.png`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
