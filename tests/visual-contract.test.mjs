import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import { drawIdentity } from "../identity.js";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("phone opens directly into a labeled, keyboard-operable form tab", () => {
  const html = read("editor.html");
  assert.match(html, /id="mobile-editor"[^>]+data-view="form"/);
  assert.match(html, /role="tablist"/);
  for (const view of ["form", "preview"]) {
    assert.match(html, new RegExp(`id="tab-${view}"[^>]+aria-controls="panel-${view}"`));
    assert.match(html, new RegExp(`id="panel-${view}"[^>]+role="tabpanel"[^>]+tabindex="0"[^>]+aria-labelledby="tab-${view}"`));
  }
  const shell = { dataset: { view: "form" } };
  const tabs = ["form", "preview"].map((view) => ({ dataset: { editorView: view }, attrs: {}, listeners: {}, classList: { toggle() {} }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(k, v) { this.listeners[k] = v; }, focus() { this.focused = true; } }));
  const notice = { classList: { toggle() {} } };
  const context = vm.createContext({ navigator: { onLine: true }, document: { querySelector: (selector) => selector === "#mobile-editor" ? shell : notice, querySelectorAll: () => tabs }, window: { matchMedia: () => ({ matches: true }), scrollTo() {}, addEventListener() {} } });
  vm.runInContext(read("editor.js"), context);
  let prevented = false;
  tabs[0].listeners.keydown({ key: "ArrowRight", preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(shell.dataset.view, "preview");
  assert.equal(tabs[1].attrs["aria-selected"], "true");
  assert.equal(tabs[0].tabIndex, -1);
  assert.equal(tabs[1].tabIndex, 0);
  tabs[1].listeners.keydown({ key: "Home", preventDefault() {} });
  assert.equal(shell.dataset.view, "form");
  tabs[0].listeners.keydown({ key: "ArrowLeft", preventDefault() {} });
  assert.equal(shell.dataset.view, "preview");
  tabs[0].listeners.click();
  assert.equal(shell.dataset.view, "form");
});

test("poster vectors preserve the exact existing wordmark and character paths without distortion", () => {
  const paths = [];
  const transforms = [];
  const oldPath = globalThis.Path2D;
  globalThis.Path2D = class { constructor(d) { this.d = d; } };
  try {
    const context = { save() {}, restore() {}, translate() {}, scale(x, y) { transforms.push([x, y]); }, fill(path) { paths.push(path.d); } };
    for (const [name, file] of [["wordmark", "mantou-wordmark-ink.svg"], ["walker", "mantou-p1-walk.svg"]]) {
      paths.length = 0;
      drawIdentity(context, name, 0, 0, 196, 51);
      const originals = [...read(`identity/${file}`).matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(paths, originals);
    }
    assert.ok(transforms.every(([x, y]) => x === y));
  } finally { if (oldPath === undefined) delete globalThis.Path2D; else globalThis.Path2D = oldPath; }
});

test("page and imported visual assets are all present in the offline shell", () => {
  const shell = read("sw.js");
  for (const page of ["index.html", "editor.html"]) {
    const html = read(page);
    const files = [...html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)].map((m) => m[1]).filter((x) => x !== "./editor" && x !== "./");
    for (const file of files) {
      assert.ok(existsSync(new URL(`../${file.split("?")[0]}`, import.meta.url)), file);
      assert.ok(shell.includes(`"${file}"`), `${file} absent from offline shell`);
    }
    assert.match(html, /name="readingMinutes" aria-label="破界行动分钟"/);
  }
  assert.ok(shell.includes('"./identity.js"'));
  assert.ok(read("scripts/build.mjs").includes('"identity.js"'));
  assert.ok(read("scripts/build.mjs").includes('path.join(projectDir, "identity")'));
});

function luminance(hex) {
  const rgb = hex.match(/\w\w/g).map((x) => parseInt(x, 16) / 255).map((n) => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
test("key text combinations meet WCAG AA normal-text contrast", () => {
  for (const [foreground, background] of [["292824", "fffaf1"], ["6b6258", "fffaf1"], ["6b6258", "edf0e3"], ["a84e32", "edf0e3"], ["fffaf1", "a84e32"]]) {
    assert.ok(contrast(foreground, background) >= 4.5, `${foreground} / ${background}: ${contrast(foreground, background)}`);
  }
});
