// Shared, side-effect-free storage/backup validation. Keep the v1 storage key and
// v2 backup shape so existing installations and exported files remain readable.
export const STORAGE_KEY = "personal-investment-checklist:v1";
export const RECOVERY_KEY = `${STORAGE_KEY}:recovery`;
export const BACKUP_FORMAT = "mantou-personal-investment-checklist";
export const TRAINING_STATUSES = ["力量训练", "激活", "恢复", "未训练"];
const TEXT_FIELDS = ["bodyPhase", "bodyMeta", "investmentPhase", "readingPhase", "nextResult", "nextResultDate", "nextResult2", "nextResultDate2", "nextResult3", "nextResultDate3", "motto"];
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

export function sanitizeWeekLog(value, weekKey) {
  if (!isObject(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([date, record]) => isISODate(date) && getWeekKey(date) === weekKey && isObject(record))
    .map(([date, record]) => [date, {
      readingMinutes: Math.min(360, Math.max(0, Number(record.readingMinutes) || 0)),
      trainingStatus: TRAINING_STATUSES.includes(record.trainingStatus) ? record.trainingStatus : "未训练",
      diaryDone: record.diaryDone === true
    }]));
}

function validateState(state) {
  if (!isObject(state) || !isISODate(state.date) || !Number.isSafeInteger(state.diaryDay) || state.diaryDay < 0) {
    throw new Error("日期或累计日记天数无效");
  }
  for (const field of TEXT_FIELDS) {
    if (field in state && (typeof state[field] !== "string" || state[field].length > 10_000)) {
      throw new Error(`文字字段无效：${field}`);
    }
  }
  if ("readingMinutes" in state && (!Number.isInteger(state.readingMinutes) || state.readingMinutes < 0 || state.readingMinutes > 360)) {
    throw new Error("破界行动分钟无效");
  }
  if ("trainingStatus" in state && !TRAINING_STATUSES.includes(state.trainingStatus)) throw new Error("训练状态无效");
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
        || !TRAINING_STATUSES.includes(record.trainingStatus) || typeof record.diaryDone !== "boolean") {
        throw new Error("周日志包含无效日期或数据");
      }
    }
    const daily = state.weekLog[state.date];
    if (daily && ["readingMinutes", "trainingStatus", "diaryDone"].some((key) => key in state && state[key] !== daily[key])) {
      throw new Error("当天记录与周日志不一致");
    }
  }
  const completed = state.weekLog
    ? Object.values(state.weekLog).filter((daily) => daily.diaryDone).length
      + Number(!Object.hasOwn(state.weekLog, state.date) && state.diaryDone === true)
    : Number(state.diaryDone === true);
  if (state.diaryDay < completed) throw new Error("累计日记少于已完成的日记记录");
  return structuredClone(state);
}

export function parseBackup(payload) {
  if (!isObject(payload)) throw new Error("备份必须是 JSON 对象");
  if ("state" in payload || "format" in payload || "version" in payload) {
    if (payload.format !== BACKUP_FORMAT || ![1, 2].includes(payload.version)) {
      throw new Error("不支持的备份格式或版本");
    }
    return validateState(payload.state);
  }
  return validateState(payload);
}

export function makeBackup(state) {
  return { format: BACKUP_FORMAT, version: 2, exportedAt: new Date().toISOString(), state: structuredClone(state) };
}
