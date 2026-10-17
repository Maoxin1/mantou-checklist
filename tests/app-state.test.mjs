import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import * as stateHelpers from "../state.js";
import { drawIdentity } from "../identity.js";

const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const config = JSON.parse(readFileSync(new URL("../config.json", import.meta.url), "utf8"));
const key = stateHelpers.STORAGE_KEY;
const base = () => ({ date: "2026-10-04", diaryDay: 100, readingMinutes: 90, trainingStatus: "力量训练", diaryDone: true, weekKey: "2026-09-28", weekLog: {
  "2026-10-01": { readingMinutes: 30, trainingStatus: "激活", diaryDone: true },
  "2026-10-04": { readingMinutes: 90, trainingStatus: "力量训练", diaryDone: true }
} });
function createApp(seed = base(), storage = new Map()) {
  let time = "2026-10-04T12:00:00";
  let timer = 0;
  const nodes = new Map();
  const posterCalls = [];
  const select = (selector) => {
    if (!nodes.has(selector)) {
      const names = { date: "date", "reading-minutes": "readingMinutes", "training-status": "trainingStatus", "diary-day": "diaryDay", "diary-done": "diaryDone", "body-meta": "bodyMeta", "reading-phase": "readingPhase", "next-result": "nextResult" };
      const id = selector.replace(/^#/, "");
      nodes.set(selector, { value: "", name: names[id], type: id === "diary-done" ? "checkbox" : "text", checked: false, min: "0", max: "180", textContent: "", listeners: {}, style: { setProperty() {} }, classList: { add() {}, remove() {} }, setAttribute() {}, addEventListener(type, fn) { this.listeners[type] = fn; } });
    }
    return nodes.get(selector);
  };
  if (seed !== undefined) storage.set(key, JSON.stringify(seed));
  const sandbox = { ...stateHelpers, drawIdentity, console, structuredClone,
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return new Date(time).getTime(); } },
    document: { querySelector: select, addEventListener() {}, fonts: { ready: Promise.resolve() }, createElement() { return { click() {}, getContext() { return new Proxy({ measureText: (text) => ({ width: String(text).length * 20 }), fillText(text, x, y) { posterCalls.push({ text, x, y, font: this.font, color: this.fillStyle }); } }, { get: (obj, key) => obj[key] || (() => {}) }); }, toDataURL() { return "data:image/png;base64,AAAA"; } }; } },
    window: { listeners: {}, matchMedia: () => ({ matches: false }), addEventListener(type, fn) { this.listeners[type] = fn; } },
    navigator: {}, setTimeout: () => ++timer, clearTimeout() {},
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(source.replace(/^import[^\n]+\n/gm, "").replace("const config = await loadConfig();", `const config = ${JSON.stringify(config)};`), context);
  return { sandbox, nodes, storage, posterCalls, eval: (code) => vm.runInContext(code, context), time: (value) => { time = value; },
    input(id, value) { const target = select(`#${id}`); if (target.type === "checkbox") target.checked = value; else target.value = String(value); select("#checklist-form").listeners.input({ target }); },
    date(value) { select("#date").value = value; select("#date").listeners.change(); }
  };
}

test("cross-week selection and repeated rendering cannot clear records or add diary days", () => {
  const app = createApp();
  const before = app.eval("JSON.stringify(getFormState())");
  app.date("2026-09-27");
  assert.equal(app.eval("JSON.stringify(getFormState())"), before);
  app.eval("createPosterDataUrl(); getFormState(); createPosterDataUrl();");
  assert.equal(app.eval("JSON.stringify(getFormState())"), before);
  app.input("diary-done", true);
  assert.equal(app.eval("state.diaryDay"), 100);
});

test("reading-focus upgrade migrates known copy without changing daily records or diary totals", async () => {
  for (const [bodyPhase, bodyMeta] of [["作息重构实验 V1", "5:00–8:00"], ["作息重构实验", "正式开启"]]) {
    const legacy = { ...base(), bodyPhase, bodyMeta, readingPhase: "认知类书籍", investmentPhase: "主动投资系统建设中", nextResult: "完成14天 V1 验收" };
    const app = createApp(legacy);
    const updated = JSON.parse(app.eval("JSON.stringify(getFormState())"));
    assert.equal(updated.bodyPhase, "作息重构");
    assert.equal(updated.bodyMeta, "进行中");
    assert.equal(updated.readingPhase, config.readingPhase);
    assert.equal(updated.nextResult, "");
    for (const field of ["readingMinutes", "diaryDay", "diaryDone", "trainingStatus", "weekLog", "investmentPhase"]) assert.deepEqual(updated[field], legacy[field]);
    assert.equal(app.storage.get(key), JSON.stringify(legacy), "Loading and previewing must not overwrite old storage");
    const text = app.posterCalls.map((call) => call.text);
    for (const retired of ["投资", "主动投资系统建设中", "本周交付物", "暂无", "完成14天 V1 验收"]) assert.ok(!text.includes(retired));
    for (const book of config.readingPhase.split("\n")) assert.ok(text.includes(book));
    assert.equal(await app.eval("saveState()"), true);
    const restored = createApp(stateHelpers.parseBackup(JSON.parse(app.storage.get(key))));
    assert.equal(restored.eval("JSON.stringify(getFormState())"), JSON.stringify(updated));
  }
});

test("custom focus, multiline books and optional results survive upgrade and backup restore", async () => {
  const custom = { ...base(), bodyPhase: "我的实验", bodyMeta: "稳定运行", readingPhase: "精读：自选书\n略读：另一部书", nextResult: "我的本周观察", nextResultDate: "已通过" };
  const app = createApp(custom);
  for (const field of ["bodyPhase", "bodyMeta", "readingPhase", "nextResult", "nextResultDate"]) assert.equal(app.eval(`state.${field}`), custom[field]);
  assert.ok(app.posterCalls.some((call) => call.text === "本周交付物"));
  app.input("reading-phase", "精读：新书\n略读：新材料");
  app.input("next-result", "");
  assert.equal(await app.eval("saveState()"), true);
  const reloaded = createApp(stateHelpers.parseBackup(JSON.parse(app.storage.get(key))));
  assert.equal(reloaded.eval("state.readingPhase"), "精读：新书\n略读：新材料");
  assert.equal(reloaded.eval("state.nextResult"), "");
  assert.ok(!reloaded.posterCalls.some((call) => call.text === "本周交付物"));
});

test("long multiline reading text wraps without crowding optional results or the footer", () => {
  const app = createApp({ ...base(), readingPhase: "精读：" + "长书名".repeat(40) + "\n略读：The Craft of Research", nextResult: "成果一", nextResult2: "成果二", nextResult3: "成果三" });
  const reading = app.posterCalls.filter((call) => call.x === 264 && call.y >= 496 && call.y < 640);
  assert.equal(reading.length, 4);
  assert.ok(reading.at(-1).text.endsWith("…"));
  assert.ok(reading.every((call) => call.text.length * 20 <= 740));
  const results = app.posterCalls.filter((call) => /^成果[一二三]$/.test(call.text));
  assert.equal(results.length, 3);
  assert.ok(results.every((call) => call.y < 1484));
});

test("same-week switching synchronizes slider and diary toggle is idempotent", () => {
  const app = createApp();
  app.date("2026-10-01");
  assert.equal(app.nodes.get("#reading-minutes-value").textContent, "30 分钟");
  app.input("diary-done", false);
  assert.equal(app.eval("state.diaryDay"), 99);
  app.input("diary-done", false);
  assert.equal(app.eval("state.diaryDay"), 99);
  app.date("2026-10-04");
  assert.equal(app.eval("state.diaryDone"), true);
  assert.equal(app.eval("state.diaryDay"), 99);
});

test("midnight input goes to the new day, preserving the cumulative total", () => {
  const app = createApp();
  app.time("2026-10-05T01:00:00");
  app.input("reading-minutes", 60);
  assert.equal(app.eval("state.date"), "2026-10-05");
  assert.equal(app.eval("state.weekKey"), "2026-10-05");
  assert.equal(app.eval("state.readingMinutes"), 60);
  assert.equal(app.eval("state.diaryDay"), 100);
  assert.deepEqual(JSON.parse(app.eval("JSON.stringify(Object.keys(state.weekLog))")), ["2026-10-05"]);
});

test("failed saves retain a detached export and PNG generation", async () => {
  const app = createApp();
  app.sandbox.localStorage.setItem = () => { throw new Error("quota"); };
  app.input("reading-minutes", 125);
  assert.equal(await app.eval("saveState()"), false);
  assert.match(app.nodes.get("#save-status").textContent, /保存失败/);
  assert.equal(app.eval("window.checklistStorage.snapshot().readingMinutes"), 125);
  assert.equal(app.eval("createPosterDataUrl()"), "data:image/png;base64,AAAA");
  await app.eval("downloadPoster()");
  assert.match(app.nodes.get("#toast").textContent, /下载/);
  app.eval("window.checklistStorage.snapshot().weekLog['2026-10-04'].readingMinutes = 0");
  assert.equal(app.eval("state.readingMinutes"), 125);
});

test("save re-reads storage and blocks a stale tab even without a storage event", async () => {
  const storage = new Map();
  const a = createApp(base(), storage);
  const b = createApp(base(), storage);
  a.input("reading-minutes", 120);
  assert.equal(await a.eval("saveState()"), true);
  b.input("body-meta", "second tab edit");
  assert.equal(await b.eval("saveState()"), false);
  assert.equal(JSON.parse(storage.get(key)).readingMinutes, 120);
  assert.equal(b.eval("state.bodyMeta"), "second tab edit");
  assert.match(b.nodes.get("#save-status").textContent, /另一窗口/);
});

test("restore validates before write and preserves pre-import unsaved state", async () => {
  const app = createApp();
  app.input("reading-minutes", 110);
  const original = app.storage.get(key);
  await assert.rejects(app.eval("restoreState({ date: 'invalid', diaryDay: null })"));
  assert.equal(app.storage.get(key), original);
  app.sandbox.candidate = { ...base(), readingMinutes: 40, weekLog: { ...base().weekLog, "2026-10-04": { readingMinutes: 40, trainingStatus: "力量训练", diaryDone: true } } };
  await app.eval("restoreState(candidate)");
  assert.equal(app.eval("state.readingMinutes"), 40);
  assert.equal(JSON.parse(app.storage.get(stateHelpers.RECOVERY_KEY)).state.readingMinutes, 110);
});

test("failed recovery or primary write never replaces the current in-memory state", async () => {
  for (const failedKey of [stateHelpers.RECOVERY_KEY, key]) {
    const app = createApp();
    const initialRaw = app.storage.get(key);
    app.sandbox.localStorage.setItem = (writeKey, value) => { if (writeKey === failedKey) throw new Error("quota"); app.storage.set(writeKey, value); };
    app.sandbox.candidate = { date: "2026-10-04", diaryDay: 5, readingMinutes: 0 };
    await assert.rejects(app.eval("restoreState(candidate)"));
    assert.equal(app.storage.get(key), initialRaw);
    assert.equal(app.eval("state.readingMinutes"), 90);
    assert.equal(app.eval("state.diaryDay"), 100);
  }
});

test("accepted legacy minutes and optional daily fields remain valid after save and reload", async () => {
  for (const minutes of [84, 185, 360]) {
    const saved = base();
    saved.readingMinutes = minutes;
    saved.weekLog[saved.date].readingMinutes = minutes;
    delete saved.diaryDone;
    const app = createApp(saved);
    assert.equal(app.eval("state.diaryDone"), true);
    assert.equal(app.eval("state.readingMinutes"), minutes);
    assert.equal(await app.eval("saveState()"), true);
    const persisted = JSON.parse(app.storage.get(key));
    assert.doesNotThrow(() => stateHelpers.parseBackup(persisted));
    const reloaded = createApp(persisted);
    assert.equal(reloaded.eval("state.diaryDone"), true);
    assert.equal(reloaded.eval("state.readingMinutes"), minutes);
    app.date("2026-10-01");
    app.date("2026-10-04");
    assert.equal(await app.eval("saveState()"), true);
    assert.doesNotThrow(() => stateHelpers.parseBackup(JSON.parse(app.storage.get(key))));
  }
});

test("manual diary total cannot fall below completed days and toggling remains reversible", () => {
  const app = createApp();
  app.input("diary-day", 0);
  assert.equal(app.eval("state.diaryDay"), 2);
  app.input("diary-done", false);
  assert.equal(app.eval("state.diaryDay"), 1);
  app.input("diary-done", true);
  assert.equal(app.eval("state.diaryDay"), 2);
  assert.throws(() => stateHelpers.parseBackup({ date: "2026-10-04", diaryDay: 0, diaryDone: true }));
});

test("top-level-only completed day is included in backup consistency checks", () => {
  const saved = base();
  saved.diaryDay = 1;
  delete saved.weekLog[saved.date];
  assert.throws(() => stateHelpers.parseBackup(saved));
  saved.diaryDay = 2;
  const app = createApp(saved);
  assert.doesNotThrow(() => stateHelpers.parseBackup(app.eval("getFormState()")));
});

test("diary total upper bound cannot make toggle cycles lose a day", () => {
  const saved = base();
  saved.diaryDay = Number.MAX_SAFE_INTEGER;
  saved.diaryDone = false;
  saved.weekLog[saved.date].diaryDone = false;
  const app = createApp(saved);
  app.input("diary-done", true);
  assert.equal(app.eval("state.diaryDone"), false);
  app.input("diary-done", false);
  assert.equal(app.eval("state.diaryDay"), Number.MAX_SAFE_INTEGER);
});

test("unreadable local data is never silently replaced by defaults", async () => {
  const app = createApp({ date: "anything", diaryDay: null });
  const original = app.storage.get(key);
  app.input("reading-minutes", 90);
  assert.equal(await app.eval("saveState()"), false);
  assert.equal(app.storage.get(key), original);
  assert.match(app.nodes.get("#save-status").textContent, /无法读取/);
});

test("storage events sync clean tabs but preserve dirty-tab work", async () => {
  const app = createApp();
  const latest = base();
  latest.diaryDay = 200;
  app.storage.set(key, JSON.stringify(latest));
  app.sandbox.window.listeners.storage({ key, newValue: JSON.stringify(latest) });
  assert.equal(app.eval("state.diaryDay"), 200);
  app.input("reading-minutes", 75);
  latest.diaryDay = 300;
  app.storage.set(key, JSON.stringify(latest));
  app.sandbox.window.listeners.storage({ key, newValue: JSON.stringify(latest) });
  assert.equal(app.eval("state.readingMinutes"), 75);
  assert.equal(await app.eval("saveState()"), false);
  assert.equal(JSON.parse(app.storage.get(key)).diaryDay, 300);
});

test("save uses the shared Web Lock and a lock failure retains unsaved work", async () => {
  const app = createApp();
  const requested = [];
  app.sandbox.navigator.locks = { async request(name, callback) { requested.push(name); return callback(); } };
  app.input("reading-minutes", 80);
  assert.equal(await app.eval("saveState()"), true);
  assert.deepEqual(requested, [key]);
  const original = app.storage.get(key);
  app.sandbox.navigator.locks.request = async () => { throw new Error("lock unavailable"); };
  app.input("reading-minutes", 85);
  assert.equal(await app.eval("saveState()"), false);
  assert.equal(app.storage.get(key), original);
  assert.equal(app.eval("state.readingMinutes"), 85);
});

test("old UI's zero total and checked days stay visible and save/reload successfully", async () => {
  const legacy = { ...base(), diaryDay: 0, investmentPhase: "Existing phase stays visible" };
  const app = createApp(legacy);
  assert.equal(app.eval("state.diaryDay"), 2);
  assert.equal(app.eval("state.diaryDone"), true);
  assert.equal(app.eval("state.readingMinutes"), 90);
  assert.equal(app.eval("state.investmentPhase"), legacy.investmentPhase);
  assert.deepEqual(JSON.parse(app.eval("JSON.stringify(state.weekLog)")), legacy.weekLog);
  assert.equal(app.storage.get(key), JSON.stringify(legacy), "Loading must not overwrite the old local value");
  assert.match(app.nodes.get("#save-status").textContent, /从 0 校正为 2/);
  assert.equal(app.nodes.get("#data-notice").hidden, false);
  assert.match(app.nodes.get("#data-notice").textContent, /从 0 校正为 2/);
  assert.doesNotThrow(() => stateHelpers.parseBackup(stateHelpers.makeBackup(app.eval("getFormState()"))));
  app.input("reading-minutes", 95);
  assert.equal(await app.eval("saveState()"), true);
  const persisted = JSON.parse(app.storage.get(key));
  assert.equal(persisted.diaryDay, 2);
  assert.equal(app.nodes.get("#data-notice").hidden, false, "Saving does not hide the correction notice");
  const reloaded = createApp(persisted);
  assert.equal(reloaded.eval("state.readingMinutes"), 95);
  assert.equal(reloaded.eval("state.investmentPhase"), legacy.investmentPhase);
  assert.equal(reloaded.eval("unreadableStorage"), false);
  assert.equal(reloaded.eval("localDiaryTotalCorrection"), null);
  assert.equal(reloaded.nodes.get("#data-notice").hidden, true);
});

test("legacy migration allows valid restore while inconsistent imports remain rejected", async () => {
  const legacy = { ...base(), diaryDay: 0 };
  const app = createApp(legacy);
  const original = app.storage.get(key);
  app.sandbox.legacy = legacy;
  await assert.rejects(app.eval("restoreState(legacy)"), /累计日记/);
  assert.equal(app.storage.get(key), original);
  assert.equal(app.eval("state.diaryDay"), 2);
  app.sandbox.valid = { ...base(), diaryDay: 200 };
  await app.eval("restoreState(valid)");
  assert.equal(app.eval("state.diaryDay"), 200);
  assert.equal(JSON.parse(app.storage.get(stateHelpers.RECOVERY_KEY)).state.diaryDay, 2);
});

test("legacy correction survives rollover and clean-tab synchronization", async () => {
  const older = { date: "2026-09-27", diaryDay: 0, diaryDone: true, readingMinutes: 90, trainingStatus: "力量训练", weekKey: "2026-09-21", weekLog: {
    "2026-09-24": { readingMinutes: 30, trainingStatus: "激活", diaryDone: true },
    "2026-09-27": { readingMinutes: 90, trainingStatus: "力量训练", diaryDone: true }
  }, investmentPhase: "Existing prior-week phase" };
  const app = createApp(older);
  assert.equal(app.eval("state.diaryDay"), 2);
  assert.equal(app.eval("state.investmentPhase"), older.investmentPhase);
  assert.equal(app.eval("state.date"), "2026-10-04");
  assert.equal(app.eval("state.weekKey"), "2026-09-28");
  assert.equal(await app.eval("saveState()"), true);
  const currentLegacy = { ...base(), diaryDay: 0 };
  app.storage.set(key, JSON.stringify(currentLegacy));
  app.sandbox.window.listeners.storage({ key, newValue: JSON.stringify(currentLegacy) });
  assert.equal(app.eval("state.diaryDay"), 2);
  assert.equal(app.eval("state.readingMinutes"), 90);
  assert.match(app.nodes.get("#save-status").textContent, /从 0 校正为 2/);
  assert.equal(app.nodes.get("#data-notice").hidden, false);
  assert.match(app.nodes.get("#data-notice").textContent, /从 0 校正为 2/);
  assert.equal(await app.eval("saveState()"), true);
});


test("poster separates actual reading from plan and preserves every recorded training state", () => {
  for (const trainingStatus of ["力量训练", "激活", "恢复", "未训练"]) {
    const seed = base();
    seed.trainingStatus = trainingStatus;
    seed.weekLog[seed.date].trainingStatus = trainingStatus;
    const app = createApp(seed);
    app.posterCalls.length = 0;
    app.eval("createPosterDataUrl()");
    const calls = app.posterCalls;
    assert.equal(calls.filter(({ text }) => text === "mantou 定投清单").length, 1);
    const actual = calls.find(({ text }) => text === "90 分钟");
    const plan = calls.find(({ text }) => text === "计划 90 分钟");
    assert.ok(actual && plan);
    assert.match(actual.font, /700 36px/);
    assert.match(plan.font, /400 26px/);
    assert.notEqual(actual.color, plan.color);
    assert.ok(actual.x < plan.x);
    const trainingLabel = calls.find(({ text }) => text === "训练记录");
    assert.ok(calls.some(({ text, y }) => text === trainingStatus && y === trainingLabel.y));
    assert.ok(calls.some(({ text }) => text === "阅读与思考 · 保底"));
    assert.equal(calls.filter(({ text }) => text.includes("7.5")).length, 1);
  }
  const posterSource = source.slice(source.indexOf("function drawEvergreenPoster"), source.indexOf("function wrapReadingText"));
  assert.ok(!posterSource.includes('"wordmark"'));
  assert.ok(posterSource.includes('"walker"'));
});


test("poster emphasizes diary status over the cumulative count without changing either", () => {
  for (const diaryDone of [false, true]) {
    const seed = base();
    seed.diaryDone = diaryDone;
    seed.weekLog[seed.date].diaryDone = diaryDone;
    const app = createApp(seed);
    app.posterCalls.length = 0;
    const before = app.eval("JSON.stringify(getFormState())");
    app.eval("createPosterDataUrl()");
    assert.equal(app.eval("JSON.stringify(getFormState())"), before);
    const status = app.posterCalls.find(({ text }) => text === (diaryDone ? "✓ 已完成" : "— 待完成"));
    const total = app.posterCalls.find(({ text }) => text === "累计有效 100 天");
    assert.ok(status && total);
    assert.match(status.font, /700 36px/);
    assert.match(total.font, /400 26px/);
    assert.notEqual(status.color, total.color);
    assert.equal(status.y, total.y);
    assert.ok(status.x < total.x);
  }
});
