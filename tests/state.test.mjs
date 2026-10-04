import test from "node:test";
import assert from "node:assert/strict";
import { isISODate, getWeekKey, weekEnd, sanitizeWeekLog, parseBackup, makeBackup } from "../state.js";

const record = { readingMinutes: 90, trainingStatus: "力量训练", diaryDone: true };
const current = () => ({ date: "2026-10-04", diaryDay: 100, weekKey: "2026-09-28", weekLog: { "2026-10-04": { ...record } }, ...record });

test("calendar validation rejects normalized invalid dates and accepts leap days", () => {
  for (const value of ["2026-02-29", "2026-99-99", "2026-04-31", "2026-1-01", "anything", null]) assert.equal(isISODate(value), false);
  assert.equal(isISODate("2024-02-29"), true);
  assert.equal(getWeekKey("2026-10-04"), "2026-09-28");
  assert.equal(getWeekKey("2026-10-05"), "2026-10-05");
  assert.equal(weekEnd("2026-09-28"), "2026-10-04");
  assert.equal(getWeekKey("2026-03-08"), "2026-03-02"); // US DST begins.
  assert.equal(getWeekKey("2026-11-01"), "2026-10-26"); // US DST ends.
});

test("sanitize only retains genuine dates in the requested week", () => {
  const log = sanitizeWeekLog({ "2026-10-04": record, "2026-10-05": record, "1999-01-01": record, "2026-99-99": record }, "2026-09-28");
  assert.deepEqual(Object.keys(log), ["2026-10-04"]);
});

test("v2/v1 envelopes and legacy states round-trip without shared references", () => {
  const source = current();
  const backup = makeBackup(source);
  assert.deepEqual(parseBackup(backup), source);
  backup.state.weekLog["2026-10-04"].diaryDone = false;
  assert.equal(source.weekLog["2026-10-04"].diaryDone, true);
  assert.deepEqual(parseBackup({ ...makeBackup(source), version: 1 }), source);
  assert.deepEqual(parseBackup({ date: "2026-10-04", diaryDay: 88, nextResultDate: "9.19验收" }), { date: "2026-10-04", diaryDay: 88, nextResultDate: "9.19验收" });
});

test("backup metadata, field types, diary bounds, and every logged date are checked", () => {
  const invalid = [null, [], {}, { date: "anything", diaryDay: null },
    { ...current(), diaryDay: "100" }, { ...current(), diaryDay: -1 }, { ...current(), diaryDay: 0.5 },
    { ...current(), diaryDay: Number.MAX_SAFE_INTEGER + 1 }, { ...current(), diaryDone: "false" },
    { ...current(), readingMinutes: "90" }, { ...current(), trainingStatus: "unknown" },
    { ...current(), bodyPhase: {} }, { ...current(), weekKey: "2026-10-05" },
    { ...current(), weekLog: [] }, { ...current(), weekLog: { "2026-10-05": record } },
    { ...current(), weekLog: { "2026-99-99": record } },
    { ...current(), weekLog: { "2026-10-04": { ...record, diaryDone: 1 } } },
    { ...current(), weekLog: { "2026-10-04": { ...record, readingMinutes: 30 } } },
    { ...makeBackup(current()), format: "other-app" }, { ...makeBackup(current()), version: 99 },
    { state: current() }, { ...current(), weekLog: undefined }
  ];
  for (const value of invalid) assert.throws(() => parseBackup(value), JSON.stringify(value));
});

test("local legacy diary totals migrate narrowly without loosening backup validation", async () => {
  const { parseLocalState } = await import("../state.js");
  const legacy = current();
  legacy.diaryDay = 0;
  legacy.weekLog["2026-10-01"] = { readingMinutes: 30, trainingStatus: "激活", diaryDone: true };
  legacy.investmentPhase = "Keep the existing phase";
  const original = structuredClone(legacy);
  const loaded = parseLocalState(legacy);
  assert.deepEqual(loaded.diaryTotalCorrection, { from: 0, to: 2 });
  assert.deepEqual(loaded.state, { ...original, diaryDay: 2 });
  assert.deepEqual(legacy, original, "Migration must not mutate the source object");
  assert.throws(() => parseBackup(legacy), /累计日记/);
  assert.throws(() => parseBackup(makeBackup(legacy)), /累计日记/);
  assert.deepEqual(parseBackup(makeBackup(loaded.state)), loaded.state);
  assert.equal(parseLocalState(loaded.state).diaryTotalCorrection, null);
});

test("local migration counts top-level-only days but rejects every other corruption", async () => {
  const { parseLocalState } = await import("../state.js");
  const legacy = { date: "2026-10-04", diaryDay: 0, diaryDone: true };
  assert.deepEqual(parseLocalState(legacy).state, { ...legacy, diaryDay: 1 });
  for (const corrupted of [
    { ...legacy, date: "2026-02-30" }, { ...legacy, diaryDay: "0" },
    { ...legacy, diaryDay: -1 }, { ...legacy, diaryDone: "true" },
    { ...legacy, weekKey: "2026-09-28", weekLog: { "2026-10-05": record } },
    { ...current(), diaryDay: 0, readingMinutes: 25 },
    { ...makeBackup(legacy), version: 99 }
  ]) assert.throws(() => parseLocalState(corrupted), JSON.stringify(corrupted));
});
