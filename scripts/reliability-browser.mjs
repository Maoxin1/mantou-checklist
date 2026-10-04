import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "./browser-path.mjs";
import { startTestServer } from "./test-server.mjs";

// Run: node scripts/reliability-browser.mjs
// CHROME_PATH may point at an installed Chromium. No browser install, remote site,
// deployment, or existing browser profile is used. Service workers are isolated
// from these state tests; scripts/smoke.mjs owns the separate offline/PWA checks.
const STORAGE_KEY = "personal-investment-checklist:v1";
const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
const BACKUP_FORMAT = "mantou-personal-investment-checklist";
const BASE_TIME = new Date("2026-10-07T08:00:00.000Z"); // Wednesday, 16:00 in Shanghai.
const TODAY = "2026-10-07";
const WEEK = "2026-10-05";
const failures = [];
let passed = 0;
const server = await startTestServer(path.resolve(import.meta.dirname, "..", "dist"));
let browser;

async function newContext({ time = BASE_TIME, fault } = {}) {
  const context = await browser.newContext({
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1280, height: 960 },
    acceptDownloads: true,
    serviceWorkers: "block"
  });
  const errors = [];
  const outsideRequests = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === server.url) return route.continue();
    outsideRequests.push(url.href);
    return route.abort("blockedbyclient");
  });
  if (fault) {
    await context.addInitScript(({ fault, key }) => {
      const getItem = Storage.prototype.getItem;
      const setItem = Storage.prototype.setItem;
      Storage.prototype.getItem = function (name) {
        if (fault === "unavailable" && name.startsWith(key)) throw new DOMException("Storage is unavailable", "SecurityError");
        return getItem.call(this, name);
      };
      Storage.prototype.setItem = function (name, value) {
        if (fault === "quota" && name.startsWith(key)) throw new DOMException("Storage quota exhausted", "QuotaExceededError");
        if (fault === "unavailable" && name.startsWith(key)) throw new DOMException("Storage is unavailable", "SecurityError");
        return setItem.call(this, name, value);
      };
    }, { fault, key: STORAGE_KEY });
  }
  async function open(route = "/editor", { suppressStorageEvents = false } = {}) {
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(8_000);
    if (suppressStorageEvents) {
      // Exercise the fresh-read save guard even when a suspended tab misses a
      // storage event. Other tests use the normal browser event delivery.
      await page.addInitScript(() => window.addEventListener("storage", (event) => event.stopImmediatePropagation(), { capture: true }));
    }
    await page.clock.setFixedTime(time);
    await page.goto(`${server.url}${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.checklistStorage?.snapshot && document.querySelector("#preview-forest")?.src.startsWith("data:image/png"));
    if (route.startsWith("/editor")) await page.locator('[data-editor-view="form"]').click();
    // This selector shrinks after each click: always take the first remaining
    // closed section instead of indexing a live locator list.
    const closedSections = page.locator("details:not([open]) > summary");
    while (await closedSections.count()) await closedSections.first().click();
    return page;
  }
  return {
    context, open,
    async close() {
      await context.close();
      assert.deepEqual(outsideRequests, [], "State tests must never contact a remote origin");
      assert.deepEqual(errors, [], "No unhandled page errors are allowed, including storage failure paths");
    }
  };
}

async function test(name, run) {
  let fixture;
  try {
    fixture = await newContext();
    await run(fixture);
    await fixture.close();
    fixture = null;
    passed += 1;
    console.log(`[reliability] PASS ${name}`);
  } catch (error) {
    failures.push({ name, message: error.stack || String(error) });
    console.error(`[reliability] FAIL ${name}\n${error.stack || error}`);
  } finally {
    if (fixture) await fixture.context.close();
  }
}

async function snapshot(page) {
  return page.evaluate(() => window.checklistStorage.snapshot());
}

async function storage(page, key = STORAGE_KEY) {
  return page.evaluate((name) => localStorage.getItem(name), key);
}

async function flush(page, expected = true) {
  const result = await page.evaluate(async () => window.checklistStorage.save());
  assert.equal(typeof result, "boolean", "save() must resolve to a boolean result");
  assert.equal(result, expected, `save() must report ${expected ? "success" : "failure"} truthfully`);
}

async function reading(page, minutes) {
  const slider = page.locator("#reading-minutes");
  assert.equal(minutes % 5, 0);
  await slider.focus();
  const fromEnd = minutes > 90;
  await slider.press(fromEnd ? "End" : "Home");
  for (let index = 0; index < (fromEnd ? 180 - minutes : minutes) / 5; index += 1) {
    await slider.press(fromEnd ? "ArrowLeft" : "ArrowRight");
  }
  assert.equal(await slider.inputValue(), String(minutes));
  assert.equal(await page.locator("#reading-minutes-value").textContent(), `${minutes} 分钟`);
  assert.equal(await slider.getAttribute("aria-valuetext"), `${minutes} 分钟`);
}

async function date(page, value) {
  // Playwright fill emits the native date control's input and change events.
  await page.locator("#date").fill(value);
}

function envelope(state) {
  return { format: BACKUP_FORMAT, version: 2, state };
}

async function exportedBackup(page, button = "#export-backup") {
  const downloadEvent = page.waitForEvent("download");
  await page.locator(button).click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.json$/);
  assert.equal(await download.failure(), null);
  const payload = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(payload.format, BACKUP_FORMAT);
  assert.equal(payload.version, 2);
  assert.equal(typeof payload.state, "object");
  assert.notEqual(payload.state, null);
  return payload;
}

async function downloadPNG(page) {
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#download-button").click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /\.png$/);
  assert.equal(await download.failure(), null);
  const png = await readFile(await download.path());
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(png.length > 10_000, "PNG download must contain a rendered poster");
  assert.equal(png.readUInt32BE(16), 1080);
  assert.equal(png.readUInt32BE(20), 1536);
  await page.waitForFunction(() => !document.querySelector("#download-button").disabled);
}

async function importBackup(page, payload, { confirm = true } = {}) {
  let dialogs = 0;
  const onDialog = async (dialog) => {
    dialogs += 1;
    if (confirm) await dialog.accept();
    else await dialog.dismiss();
  };
  page.on("dialog", onDialog);
  try {
    await page.locator("#backup-file").setInputFiles({
      name: "reliability-fixture.json",
      mimeType: "application/json",
      buffer: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))
    });
    await page.waitForFunction(() => document.querySelector("#backup-file").value === "");
    return dialogs;
  } finally {
    page.off("dialog", onDialog);
  }
}

async function wakeAt(page, instant) {
  await page.clock.setFixedTime(new Date(instant));
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

async function storageErrorIsVisible(page) {
  await page.waitForFunction(() => /失败|无法|未保存|冲突|另一|其他标签|空间不足|存储受限|不可用|不可读|未能|未完成/.test(document.querySelector("#save-status")?.textContent || ""));
  assert.equal(await page.locator("#save-status").isVisible(), true);
}

try {
  // One normal launch attempt; there is intentionally no sandbox bypass/retry.
  browser = await chromium.launch({ executablePath: findChromeExecutable(), headless: true });

  for (const route of ["/", "/editor"]) {
    await test(`${route}: reject out-of-week dates without corrupting pending daily edits`, async ({ open }) => {
      const page = await open(route);
      assert.equal(await page.locator("#date").inputValue(), TODAY);
      assert.equal(await page.locator("#date").getAttribute("min"), WEEK);
      assert.equal(await page.locator("#date").getAttribute("max"), "2026-10-11");
      await page.locator("#diary-done").check();
      await reading(page, 65);
      await page.locator("#training-status").selectOption("力量训练");
      const before = await snapshot(page);
      for (const invalid of ["2026-10-04", "2026-10-12", ""]) {
        await date(page, invalid);
        assert.equal(await page.locator("#date").inputValue(), TODAY);
        assert.deepEqual(await snapshot(page), before, `Rejected date ${JSON.stringify(invalid)} must not change state`);
      }
      await flush(page);
      const saved = JSON.parse(await storage(page));
      assert.equal(saved.readingMinutes, 65);
      assert.equal(saved.weekLog[TODAY].readingMinutes, 65);
      assert.equal(saved.weekLog[TODAY].diaryDone, true);
      assert.equal(saved.weekKey, WEEK);
    });
  }

  await test("date switches keep separate daily values, slider badge, and diary total", async ({ open }) => {
    const page = await open();
    const originalTotal = (await snapshot(page)).diaryDay;
    await page.locator("#diary-done").check();
    await reading(page, 65);
    // Deliberately switch before the debounce has to persist the first day's edit.
    await date(page, "2026-10-06");
    assert.equal(await page.locator("#reading-minutes").inputValue(), "0");
    assert.equal(await page.locator("#reading-minutes-value").textContent(), "0 分钟");
    assert.equal(await page.locator("#diary-done").isChecked(), false);
    await reading(page, 135);
    await page.locator("#training-status").selectOption("恢复");
    await page.locator("#diary-done").check();
    assert.equal((await snapshot(page)).diaryDay, originalTotal + 2);
    await date(page, TODAY);
    assert.equal(await page.locator("#reading-minutes-value").textContent(), "65 分钟");
    assert.equal(await page.locator("#reading-minutes").getAttribute("aria-valuetext"), "65 分钟");
    assert.equal(await page.locator("#diary-done").isChecked(), true);
    await page.locator("#diary-done").uncheck();
    const after = await snapshot(page);
    assert.equal(after.diaryDay, originalTotal + 1);
    assert.equal(after.weekLog["2026-10-06"].readingMinutes, 135);
    assert.equal(after.weekLog["2026-10-06"].diaryDone, true);
    assert.equal(after.weekLog[TODAY].diaryDone, false);
    await flush(page);
  });

  await test("preview and JSON export are observational and include unsaved edits", async ({ open }) => {
    const page = await open();
    await reading(page, 45);
    await date(page, "2026-10-06");
    await reading(page, 90);
    await flush(page);
    const before = await snapshot(page);
    const storedBefore = await storage(page);
    const result = await page.evaluate(() => {
      const images = [window.checklistExporter.toDataUrl(), window.checklistExporter.toDataUrl()];
      const oneSnapshot = window.checklistStorage.snapshot();
      oneSnapshot.weekLog[oneSnapshot.date].readingMinutes = 175;
      return images.map((image) => image.startsWith("data:image/png;base64,"));
    });
    assert.deepEqual(result, [true, true]);
    assert.deepEqual(await snapshot(page), before, "Poster generation and callers mutating a snapshot must not mutate live state");
    assert.deepEqual((await exportedBackup(page)).state, before);
    assert.equal(await storage(page), storedBefore, "Read-only export must not write storage metadata or state");
    await reading(page, 95);
    const unsaved = await snapshot(page);
    const exported = await exportedBackup(page);
    assert.deepEqual(exported.state, unsaved, "JSON must export the current in-memory edits");
  });

  await test("local midnight follows today but preserves explicit current-week date selection", async ({ open }) => {
    const page = await open();
    await reading(page, 75);
    await page.locator("#diary-done").check();
    const before = await snapshot(page);
    // UTC is still Wednesday here, but the user's local calendar is Thursday.
    await wakeAt(page, "2026-10-07T16:05:00.000Z");
    await page.waitForFunction(() => document.querySelector("#date").value === "2026-10-08");
    let after = await snapshot(page);
    assert.equal(after.readingMinutes, 0);
    assert.equal(after.diaryDone, false);
    assert.equal(after.diaryDay, before.diaryDay);
    assert.equal(after.weekLog[TODAY].readingMinutes, 75);
    await date(page, "2026-10-06");
    await reading(page, 30);
    await wakeAt(page, "2026-10-08T16:05:00.000Z");
    after = await snapshot(page);
    assert.equal(after.date, "2026-10-06", "An explicitly selected older day must not advance within the same week");
    assert.equal(after.readingMinutes, 30);
  });

  await test("new local week drops the old weekly log and preserves cumulative diary count", async ({ open }) => {
    const page = await open();
    await reading(page, 105);
    await page.locator("#diary-done").check();
    await date(page, "2026-10-06");
    await reading(page, 35);
    const before = await snapshot(page);
    await wakeAt(page, "2026-10-11T16:05:00.000Z"); // Monday locally.
    await page.waitForFunction(() => document.querySelector("#date").value === "2026-10-12");
    const after = await snapshot(page);
    assert.equal(after.weekKey, "2026-10-12");
    assert.equal(after.date, "2026-10-12");
    assert.equal(after.readingMinutes, 0);
    assert.equal(after.diaryDone, false);
    assert.equal(after.diaryDay, before.diaryDay);
    assert.ok(Object.keys(after.weekLog).every((key) => key >= "2026-10-12" && key <= "2026-10-18"));
    assert.equal(await page.locator("#date").getAttribute("min"), "2026-10-12");
    assert.equal(await page.locator("#date").getAttribute("max"), "2026-10-18");
    await flush(page);
  });

  for (const fault of ["quota", "unavailable"]) {
    await test(`${fault} storage leaves edits and PNG/JSON downloads usable`, async () => {
      const fixture = await newContext({ fault });
      try {
        const page = await fixture.open();
        await reading(page, 115);
        await page.locator("#training-status").selectOption("激活");
        await page.locator("#diary-done").check();
        await flush(page, false);
        await storageErrorIsVisible(page);
        const current = await snapshot(page);
        assert.equal(current.readingMinutes, 115);
        assert.equal(current.trainingStatus, "激活");
        assert.equal(current.diaryDone, true);
        assert.deepEqual((await exportedBackup(page)).state, current);
        await downloadPNG(page);
        assert.deepEqual(await snapshot(page), current);
        await storageErrorIsVisible(page);
        await fixture.close();
      } finally {
        await fixture.context.close();
      }
    });
  }

  await test("valid v2 import saves a pre-import recovery envelope and survives reload", async ({ open }) => {
    const page = await open();
    await reading(page, 40);
    await flush(page);
    const old = await snapshot(page);
    const imported = structuredClone(old);
    imported.readingMinutes = 120;
    imported.weekLog[imported.date].readingMinutes = 120;
    imported.diaryDay += 10;
    assert.equal(await importBackup(page, envelope(imported)), 1);
    assert.deepEqual(await snapshot(page), imported);
    const recovery = JSON.parse(await storage(page, RECOVERY_KEY));
    assert.equal(recovery.format, BACKUP_FORMAT);
    assert.equal(recovery.version, 2);
    assert.deepEqual(recovery.state, old);
    assert.deepEqual((await exportedBackup(page, "#export-recovery")).state, old);
    assert.deepEqual(await snapshot(page), imported, "Recovery download must leave the imported state unchanged");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.checklistStorage?.snapshot);
    assert.deepEqual(await snapshot(page), imported);
  });

  await test("malformed, future, invalid-type and invalid-calendar backups never mutate data", async ({ open }) => {
    const page = await open();
    await reading(page, 55);
    await flush(page);
    const before = await snapshot(page);
    const rawBefore = await storage(page);
    const recoveryBefore = await storage(page, RECOVERY_KEY);
    const mutate = (change) => { const payload = envelope(structuredClone(before)); change(payload); return payload; };
    const invalid = [
      ["invalid JSON", "{this is not json"],
      ["null", "null"],
      ["array", []],
      ["future version", mutate((p) => { p.version = 999; })],
      ["wrong format", mutate((p) => { p.format = "another-app"; })],
      ["string version", mutate((p) => { p.version = "2"; })],
      ["string diary total", mutate((p) => { p.state.diaryDay = "100"; })],
      ["fractional diary total", mutate((p) => { p.state.diaryDay = 1.5; })],
      ["negative diary total", mutate((p) => { p.state.diaryDay = -1; })],
      ["string reading", mutate((p) => { p.state.readingMinutes = "90"; })],
      ["conflicting duplicate day", mutate((p) => { p.state.readingMinutes = 90; })],
      ["reading outside range", mutate((p) => { p.state.readingMinutes = 999; })],
      ["string boolean", mutate((p) => { p.state.diaryDone = "false"; })],
      ["unknown training", mutate((p) => { p.state.trainingStatus = "not-a-training-status"; })],
      ["object text", mutate((p) => { p.state.bodyPhase = {}; })],
      ["invalid date", mutate((p) => { p.state.date = "2026-02-30"; })],
      ["invalid week date", mutate((p) => { p.state.weekKey = "2026-02-30"; })],
      ["out-of-week day", mutate((p) => { p.state.weekLog["2026-10-04"] = { readingMinutes: 10, trainingStatus: "未训练", diaryDone: false }; })],
      ["invalid log calendar date", mutate((p) => { p.state.weekLog["2026-02-30"] = { readingMinutes: 10, trainingStatus: "未训练", diaryDone: false }; })],
      ["invalid log type", mutate((p) => { p.state.weekLog[TODAY].diaryDone = "true"; })],
      ["array week log", mutate((p) => { p.state.weekLog = []; })]
    ];
    for (const [name, payload] of invalid) {
      assert.equal(await importBackup(page, payload), 0, `${name}: validate before asking permission to replace data`);
      assert.deepEqual(await snapshot(page), before, `${name}: current form data must remain intact`);
      assert.equal(await storage(page), rawBefore, `${name}: persisted data must remain intact`);
      assert.equal(await storage(page, RECOVERY_KEY), recoveryBefore, `${name}: recovery data must remain intact`);
    }
  });

  await test("cancelled import leaves current and recovery data unchanged", async ({ open }) => {
    const page = await open();
    await reading(page, 50);
    await flush(page);
    const before = await snapshot(page);
    const raw = await storage(page);
    const incoming = structuredClone(before);
    incoming.diaryDay += 10;
    assert.equal(await importBackup(page, envelope(incoming), { confirm: false }), 1);
    assert.deepEqual(await snapshot(page), before);
    assert.equal(await storage(page), raw);
    assert.equal(await storage(page, RECOVERY_KEY), null);
  });

  for (const failingKey of [RECOVERY_KEY, STORAGE_KEY]) {
    await test(`failed ${failingKey === RECOVERY_KEY ? "recovery" : "replacement"} write aborts import transaction`, async ({ open }) => {
      const page = await open();
      await reading(page, 60);
      await flush(page);
      const before = await snapshot(page);
      const raw = await storage(page);
      const previousRecovery = envelope({ ...before, diaryDay: before.diaryDay - 1 });
      await page.evaluate(({ key, value }) => localStorage.setItem(key, value), { key: RECOVERY_KEY, value: JSON.stringify(previousRecovery) });
      await page.evaluate((key) => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (name, value) {
          if (name === key) throw new DOMException("Injected quota failure", "QuotaExceededError");
          return original.call(this, name, value);
        };
      }, failingKey);
      const incoming = structuredClone(before);
      incoming.diaryDay += 100;
      assert.equal(await importBackup(page, envelope(incoming)), 1);
      assert.deepEqual(await snapshot(page), before, "Failed import must leave the current in-memory form untouched");
      assert.equal(await storage(page), raw, "Failed import must leave durable current data untouched");
      const recovery = JSON.parse(await storage(page, RECOVERY_KEY));
      assert.deepEqual(recovery.state, failingKey === RECOVERY_KEY ? previousRecovery.state : before);
      await storageErrorIsVisible(page);
    });
  }

  await test("legacy local totals migrate without hiding data or weakening import validation", async ({ open }) => {
    const page = await open();
    const legacy = await snapshot(page);
    legacy.diaryDay = 0;
    legacy.diaryDone = true;
    legacy.readingMinutes = 55;
    legacy.investmentPhase = "Existing personal phase";
    legacy.weekLog = {
      [TODAY]: { readingMinutes: 55, trainingStatus: legacy.trainingStatus, diaryDone: true },
      "2026-10-06": { readingMinutes: 35, trainingStatus: "恢复", diaryDone: true }
    };
    const raw = JSON.stringify(legacy);
    await page.evaluate(({ key, raw }) => localStorage.setItem(key, raw), { key: STORAGE_KEY, raw });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.checklistStorage?.snapshot);
    const migrated = await snapshot(page);
    assert.deepEqual(migrated, { ...legacy, diaryDay: 2 });
    assert.equal(await storage(page), raw, "Read-time migration must not overwrite the source value");
    assert.equal(await page.locator("#mobile-editor").getAttribute("data-view"), "form");
    await page.locator('[data-editor-view="preview"]').click();
    assert.equal(await page.locator("#data-notice").isVisible(), true, "Migration notice must be visible in the preview view");
    assert.match(await page.locator("#data-notice").textContent(), /从 0 校正为 2/);
    await downloadPNG(page);
    assert.equal(await page.locator("#data-notice").isVisible(), true, "Saving from preview must not erase the correction notice");
    await page.locator('[data-editor-view="form"]').click();
    const closedSections = page.locator("details:not([open]) > summary");
    while (await closedSections.count()) await closedSections.first().click();
    assert.equal(await page.locator("#reading-minutes-value").textContent(), "55 分钟");
    assert.deepEqual((await exportedBackup(page)).state, migrated);
    assert.equal(await importBackup(page, envelope(legacy)), 0, "Backup import remains strict");
    await reading(page, 65);
    await flush(page);
    const saved = await snapshot(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.checklistStorage?.snapshot);
    assert.deepEqual(await snapshot(page), saved);
    await page.locator('[data-editor-view="form"]').click();
    while (await closedSections.count()) await closedSections.first().click();
    const replacement = { ...saved, diaryDay: 200 };
    assert.equal(await importBackup(page, envelope(replacement)), 1, "Migrated local data must not block restore");
    assert.equal((await snapshot(page)).diaryDay, 200);
    assert.deepEqual(JSON.parse(await storage(page, RECOVERY_KEY)).state, saved);
  });

  await test("a stale second tab cannot overwrite newer work and can still export its input", async ({ open }) => {
    const first = await open();
    await reading(first, 20);
    await flush(first);
    const stale = await open("/editor", { suppressStorageEvents: true });
    // Both tabs started from the same durable state. First tab publishes a change.
    await reading(first, 95);
    await flush(first);
    const winner = await storage(first);
    // The old tab now tries an actual user edit. Conservative conflict blocking
    // is accepted: it must preserve both the winner and this local unsaved input.
    await reading(stale, 145);
    await flush(stale, false);
    assert.equal(await storage(first), winner, "A stale writer must not clobber the newer tab");
    assert.equal((await snapshot(stale)).readingMinutes, 145, "A conflict must not erase local input");
    await storageErrorIsVisible(stale);
    assert.equal((await exportedBackup(stale)).state.readingMinutes, 145);
    await downloadPNG(stale);
    assert.equal(await storage(first), winner, "Conflict-path downloads must not overwrite the newer tab");
    assert.equal((await snapshot(stale)).readingMinutes, 145);
  });
} catch (error) {
  failures.push({ name: "browser/setup", message: error.stack || String(error) });
  console.error(`[reliability] Browser/setup failed; no bypass or automatic retry attempted\n${error.stack || error}`);
} finally {
  if (browser) await browser.close();
  await server.close();
}

console.log(`[reliability] ${passed} passed; ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
