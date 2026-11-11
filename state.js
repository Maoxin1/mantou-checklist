// v3 retains daily history; the original storage key and v1/v2 imports remain supported.
export const STORAGE_KEY = "personal-investment-checklist:v1";
export const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
export const BACKUP_FORMAT = "mantou-personal-investment-checklist";
export const TRAINING_STATUSES = ["力量训练", "羽毛球", "耐力训练", "有氧运动", "瑜伽", "体育活动", "激活", "恢复", "未训练"];
export function isTrainingStatus(value) {
  return typeof value === "string" && value.length > 0 && value.length <= 20
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
export function parseTrainingOptions(value) {
  return [...new Set(String(value || "").split(/\r?\n/u).map((item) => item.trim())
    .filter((item) => isTrainingStatus(item) && !TRAINING_STATUSES.includes(item)))].slice(0, 8);
}
const PERSONALIZATION_LIMITS = { posterTitle: 20, readingLabel: 10, trainingLabel: 10, diaryLabel: 10, customTrainingOptions: 240 };
const TEXT_FIELDS = ["bodyPhase", "bodyMeta", "investmentPhase", "readingPhase", "nextResult", "nextResultDate", "nextResult2", "nextResultDate2", "nextResult3", "nextResultDate3", "motto", ...Object.keys(PERSONALIZATION_LIMITS)];
const isObject = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));

export function toLocalISODate(date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseLocalDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0); // Avoid DST transitions around local midnight.
  return date;
}

export function isISODate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && toLocalISODate(parseLocalDate(value)) === value;
}

export function getWeekKey(value) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() - (date.getDay() || 7) + 1);
  return toLocalISODate(date);
}

export function weekEnd(weekKey) {
  const date = parseLocalDate(weekKey);
  date.setDate(date.getDate() + 6);
  return toLocalISODate(date);
}

export function shiftDate(value, days) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return toLocalISODate(date);
}

export function countDiaryDays(log) {
  return Object.values(log).filter((daily) => daily.diaryDone).length;
}

export function migrateDailyHistory(saved, initialTotal = 0) {
  if (saved?.dailyLog) return { dailyLog: structuredClone(saved.dailyLog), diaryBase: saved.diaryBase };
  const dailyLog = structuredClone(saved?.weekLog || {});
  if (isISODate(saved?.date) && !dailyLog[saved.date]) {
    dailyLog[saved.date] = {
      readingMinutes: saved.readingMinutes ?? 0,
      trainingStatus: saved.trainingStatus || "未训练",
      diaryDone: saved.diaryDone === true
    };
  }
  return { dailyLog, diaryBase: Math.max(0, (saved?.diaryDay ?? initialTotal) - countDiaryDays(dailyLog)) };
}

export function sanitizeWeekLog(value, weekKey) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([date, record]) => isISODate(date) && getWeekKey(date) === weekKey && isObject(record))
    .map(([date, record]) => [date, {
      readingMinutes: Math.min(360, Math.max(0, Number(record.readingMinutes) || 0)),
      trainingStatus: isTrainingStatus(record.trainingStatus) ? record.trainingStatus : "未训练",
      diaryDone: record.diaryDone === true
    }]));
}

function validateState(state, { migrateLegacyDiaryTotal = false } = {}) {
  if (!isObject(state) || !isISODate(state.date) || !Number.isSafeInteger(state.diaryDay) || state.diaryDay < 0) {
    throw new Error("日期或累计日记天数无效");
  }
  for (const field of TEXT_FIELDS) {
    if (field in state && (typeof state[field] !== "string" || state[field].length > 10_000)) {
      throw new Error(`文字字段无效：${field}`);
    }
  }
  for (const [field, max] of Object.entries(PERSONALIZATION_LIMITS)) {
    if (field in state && (state[field].length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(state[field]))) {
      throw new Error(`个性化字段无效：${field}`);
    }
  }
  if ("readingMinutes" in state && (!Number.isInteger(state.readingMinutes) || state.readingMinutes < 0 || state.readingMinutes > 360)) {
    throw new Error("阅读与思考分钟无效");
  }
  if ("trainingStatus" in state && !isTrainingStatus(state.trainingStatus)) throw new Error("训练状态无效");
  if ("diaryDone" in state && typeof state.diaryDone !== "boolean") throw new Error("日记完成状态无效");
  // Old (pre-week-log) raw states are supported. A partial or inconsistent week
  // structure is rejected rather than silently clearing or counting other weeks.
  if ("weekKey" in state || "weekLog" in state) {
    if (!isISODate(state.weekKey) || state.weekKey !== getWeekKey(state.date) || !isObject(state.weekLog)) {
      throw new Error("周日志与日期不一致");
    }
    for (const [date, record] of Object.entries(state.weekLog)) {
      if (!isISODate(date) || getWeekKey(date) !== state.weekKey || !isObject(record)
        || !Number.isInteger(record.readingMinutes) || record.readingMinutes < 0 || record.readingMinutes > 360
        || !isTrainingStatus(record.trainingStatus) || typeof record.diaryDone !== "boolean") {
        throw new Error("周日志包含无效日期或数据");
      }
    }
    const daily = state.weekLog[state.date];
    if (daily && ["readingMinutes", "trainingStatus", "diaryDone"].some((key) => key in state && state[key] !== daily[key])) {
      throw new Error("当天记录与周日志不一致");
    }
  }
  if ("dailyLog" in state || "diaryBase" in state) {
    if (!isObject(state.dailyLog) || !Number.isSafeInteger(state.diaryBase) || state.diaryBase < 0) {
      throw new Error("历史日志或日记起始值无效");
    }
    for (const [date, daily] of Object.entries(state.dailyLog)) {
      if (!isISODate(date) || !isObject(daily)
        || !Number.isInteger(daily.readingMinutes) || daily.readingMinutes < 0 || daily.readingMinutes > 360
        || !isTrainingStatus(daily.trainingStatus) || typeof daily.diaryDone !== "boolean") {
        throw new Error("历史日志包含无效日期或数据");
      }
    }
    const projected = sanitizeWeekLog(state.dailyLog, state.weekKey);
    if (!isObject(state.weekLog) || Object.keys(projected).length !== Object.keys(state.weekLog).length
      || Object.entries(projected).some(([date, daily]) =>
        ["readingMinutes", "trainingStatus", "diaryDone"].some((key) => daily[key] !== state.weekLog[date]?.[key]))) {
      throw new Error("历史日志与周日志不一致");
    }
    const selected = state.dailyLog[state.date];
    if (!selected && (state.readingMinutes !== 0 || state.trainingStatus !== "未训练" || state.diaryDone !== false)) {
      throw new Error("未记录日期包含每日数据");
    }
    if (state.diaryDay !== state.diaryBase + countDiaryDays(state.dailyLog)) {
      throw new Error("累计日记与历史日志不一致");
    }
  }
  const completed = state.weekLog
    ? Object.values(state.weekLog).filter((daily) => daily.diaryDone).length
      + Number(!Object.hasOwn(state.weekLog, state.date) && state.diaryDone === true)
    : Number(state.diaryDone === true);
  if (state.diaryDay < completed && !migrateLegacyDiaryTotal) {
    throw new Error("累计日记少于已完成的日记记录");
  }
  const validated = structuredClone(state);
  // The pre-reliability UI allowed manually setting totals below checked days.
  // Only local-state loading may repair this known legacy invariant. All other
  // validation above still applies, and backup imports remain strict.
  if (migrateLegacyDiaryTotal) validated.diaryDay = Math.max(validated.diaryDay, completed);
  return validated;
}

function unwrapState(payload) {
  if (!isObject(payload)) throw new Error("备份必须是 JSON 对象");
  if ("state" in payload || "format" in payload || "version" in payload) {
    if (payload.format !== BACKUP_FORMAT || ![1, 2, 3].includes(payload.version)) {
      throw new Error("不支持的备份格式或版本");
    }
    if (payload.version === 3 && (!isObject(payload.state) || !Object.hasOwn(payload.state, "dailyLog"))) {
      throw new Error("新版备份缺少历史日志");
    }
    return payload.state;
  }
  return payload;
}

export function parseBackup(payload) {
  return validateState(unwrapState(payload));
}

export function parseLocalState(payload) {
  const original = unwrapState(payload);
  const state = validateState(original, { migrateLegacyDiaryTotal: true });
  return {
    state,
    diaryTotalCorrection: state.diaryDay === original.diaryDay
      ? null : { from: original.diaryDay, to: state.diaryDay }
  };
}

export function makeBackup(state) {
  return { format: BACKUP_FORMAT, version: state.dailyLog ? 3 : 2, exportedAt: new Date().toISOString(), state: structuredClone(state) };
}
