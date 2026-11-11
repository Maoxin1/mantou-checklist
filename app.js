import { STORAGE_KEY, RECOVERY_KEY, getWeekKey, toLocalISODate, isISODate, sanitizeWeekLog, parseBackup, parseLocalState, makeBackup, TRAINING_STATUSES, isTrainingStatus, parseTrainingOptions, shiftDate, countDiaryDays, migrateDailyHistory } from "./state.js";
import { drawIdentity } from "./identity.js";

const fallbackConfig = {
  diaryDay: 1291,
  bodyPhase: "作息重构",
  bodyMeta: "进行中",
  readingPhase: "精读：《Beyond Feelings》\n略读：《The Craft of Research》",
  readingTargetMinutes: 90,
  weeklyReadingTargetMinutes: 450,
  weeklyStrengthTarget: 3,
  trainingTrial: { start: "2026-10-27", end: "2026-11-09" },
  trainingPlan: { start: "2026-11-10", label: "三日力量 · 持续训练", schedule: "周一 A · 周三 B · 周五 C · 周末一次羽毛球" },
  trainingStatus: "未训练",
  nextResult: "",
  nextResultDate: "待验收",
  nextResult2: "",
  nextResultDate2: "待验收",
  nextResult3: "",
  nextResultDate3: "待验收",
  motto: "把时间转化为能力、资本与自主权。",
  posterTitle: "mantou 定投清单",
  readingLabel: "阅读与思考",
  trainingLabel: "训练记录",
  diaryLabel: "日记",
  customTrainingOptions: ""
};

const config = await loadConfig();

const elements = {
  form: document.querySelector("#checklist-form"),
  date: document.querySelector("#date"),
  bodyPhase: document.querySelector("#body-phase"),
  bodyMeta: document.querySelector("#body-meta"),
  readingPhase: document.querySelector("#reading-phase"),
  readingName: document.querySelector("#reading-name"),
  trainingName: document.querySelector("#training-name"),
  diaryName: document.querySelector("#diary-name"),
  diaryDayName: document.querySelector("#diary-day-name"),
  posterTitle: document.querySelector("#poster-title"),
  readingLabel: document.querySelector("#reading-label"),
  trainingLabel: document.querySelector("#training-label"),
  diaryLabel: document.querySelector("#diary-label"),
  customTrainingOptions: document.querySelector("#custom-training-options"),
  readingTarget: document.querySelector("#reading-target"),
  readingMinutes: document.querySelector("#reading-minutes"),
  readingMinutesValue: document.querySelector("#reading-minutes-value"),
  trainingTrialPeriod: document.querySelector("#training-trial-period"),
  trainingTrialSchedule: document.querySelector("#training-trial-schedule"),
  trainingTrialStatus: document.querySelector("#training-trial-status"),
  trainingStatus: document.querySelector("#training-status"),
  diaryDone: document.querySelector("#diary-done"),
  diaryDay: document.querySelector("#diary-day"),
  nextResult: document.querySelector("#next-result"),
  nextResultDate: document.querySelector("#next-result-date"),
  nextResult2: document.querySelector("#next-result-2"),
  nextResultDate2: document.querySelector("#next-result-date-2"),
  nextResult3: document.querySelector("#next-result-3"),
  nextResultDate3: document.querySelector("#next-result-date-3"),
  motto: document.querySelector("#motto"),
  phaseDefaults: document.querySelector("#apply-phase-defaults"),
  download: document.querySelector("#download-button"),
  install: document.querySelector("#install-button"),
  saveStatus: document.querySelector("#save-status"),
  dataNotice: document.querySelector("#data-notice"),
  toast: document.querySelector("#toast"),
  previewForest: document.querySelector("#preview-forest")
};

let installPrompt = null;
let saveTimer = null;
let previewTimer = null;
let state;
let observedToday = toLocalISODate(new Date());
let baselineRaw = null;
let dirty = false;
let conflict = false;
let unreadableStorage = false;
let localDiaryTotalCorrection = null;
let calendarTimer = null;
let pendingWrite = Promise.resolve();

window.checklistExporter = { toDataUrl: createPosterDataUrl };
window.checklistStorage = {
  key: STORAGE_KEY,
  recoveryKey: RECOVERY_KEY,
  snapshot: getFormState,
  save: saveState,
  restore: restoreState,
  recovery() {
    try { return JSON.parse(localStorage.getItem(RECOVERY_KEY) || "null"); }
    catch { return null; }
  }
};

initialize();

async function loadConfig() {
  try {
    const response = await fetch("./config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Config unavailable");
    return { ...fallbackConfig, ...(await response.json()) };
  } catch {
    return fallbackConfig;
  }
}

function initialize() {
  const saved = loadState();
  state = buildInitialState(saved, observedToday);
  fillForm(state);
  render(true);
  bindEvents();
  scheduleCalendarCheck();
  registerServiceWorker();
}

function buildInitialState(saved, today) {
  const currentWeek = getWeekKey(today);
  const { dailyLog, diaryBase } = migrateDailyHistory(saved, config.diaryDay);
  const weekLog = sanitizeWeekLog(dailyLog, currentWeek);
  const daily = weekLog[today] || {};
  const sameDay = saved?.date === today;

  return {
    date: today,
    bodyPhase: migrateLegacyText(saved?.bodyPhase, ["减脂收官", "精干强健计划", "作息重构实验 V1", "作息重构实验"], config.bodyPhase),
    bodyMeta: migrateLegacyText(saved?.bodyMeta, ["9.19验收", "持续期", "5:00–8:00", "正式开启"], config.bodyMeta),
    // Keep legacy backup content readable without exposing the retired investment field.
    investmentPhase: saved?.investmentPhase || "",
    readingPhase: migrateLegacyText(saved?.readingPhase, ["Beyond Feelings · W1", "认知类书籍"], config.readingPhase),
    readingMinutes: sameDay && saved?.readingMinutes !== undefined
      ? normalizeReadingMinutes(saved.readingMinutes)
      : normalizeReadingMinutes(daily.readingMinutes),
    trainingStatus: sameDay && saved?.trainingStatus
      ? normalizeTrainingStatus(saved.trainingStatus)
      : normalizeTrainingStatus(daily.trainingStatus),
    diaryDone: sameDay && saved?.diaryDone !== undefined ? saved.diaryDone : Boolean(daily.diaryDone),
    diaryDay: diaryBase + countDiaryDays(dailyLog),
    diaryBase,
    dailyLog,
    weekKey: currentWeek,
    weekLog,
    nextResult: migrateLegacyText(saved?.nextResult, ["批判性判断框架 v0.1", "完成14天 V1 验收"], config.nextResult),
    nextResultDate: normalizeAcceptanceStatus(saved?.nextResultDate || config.nextResultDate),
    nextResult2: saved?.nextResult2 || config.nextResult2,
    nextResultDate2: normalizeAcceptanceStatus(saved?.nextResultDate2 || config.nextResultDate2),
    nextResult3: saved?.nextResult3 || config.nextResult3,
    nextResultDate3: normalizeAcceptanceStatus(saved?.nextResultDate3 || config.nextResultDate3),
    motto: saved?.motto || config.motto,
    posterTitle: saved?.posterTitle ?? config.posterTitle,
    readingLabel: saved?.readingLabel ?? config.readingLabel,
    trainingLabel: saved?.trainingLabel ?? config.trainingLabel,
    diaryLabel: saved?.diaryLabel ?? config.diaryLabel,
    customTrainingOptions: saved?.customTrainingOptions ?? config.customTrainingOptions
  };
}

function bindEvents() {
  elements.form.addEventListener("input", (event) => {
    const target = event.target;
    if (target === elements.date) return; // Date transitions have their own commit.
    const value = target.type === "checkbox" ? target.checked : target.value;
    if (refreshCalendar()) {
      if (target.type === "checkbox") target.checked = value;
      else target.value = value;
    }
    const field = target.name;
    if (!(field in state) || field === "weekLog" || field === "weekKey") return;
    if (field === "diaryDone") {
      if (value && !state.diaryDone && state.diaryDay === Number.MAX_SAFE_INTEGER) {
        elements.diaryDone.checked = false;
        showToast("累计日记天数已达上限，请先校正累计天数");
        return;
      }
    }
    state[field] = field === "readingMinutes" ? normalizeReadingMinutes(value)
      : field === "diaryDay" ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(completedDiaryDays(), Math.trunc(Number(value) || 0)))
      : typeof value === "string" ? value.trim() : value;
    if (["readingLabel", "trainingLabel", "diaryLabel"].includes(field)) syncDisplayLabels();
    if (field === "customTrainingOptions") syncTrainingOptions();
    if (["readingMinutes", "trainingStatus", "diaryDone"].includes(field)) recordCurrentDay();
    if (field === "diaryDay") state.diaryBase = state.diaryDay - completedDiaryDays();
    dirty = true;
    // Do not rewrite text inputs on every keystroke (caret/IME composition).
    elements.diaryDay.value = state.diaryDay;
    elements.diaryDone.checked = state.diaryDone;
    syncReadingSlider(state.readingMinutes);
    render();
    queueSave();
  });

  elements.date.addEventListener("change", () => {
    const nextDate = elements.date.value;
    refreshCalendar();
    if (!isISODate(nextDate) || nextDate < "0001-01-01" || nextDate > observedToday) {
      elements.date.value = state.date;
      showToast("请选择今天或过去的日期");
      return;
    }
    selectDate(nextDate);
    dirty = true;
    render();
    void saveState();
  });

  const navigate = (date) => {
    elements.date.value = date;
    elements.date.dispatchEvent(new Event("change"));
  };
  document.querySelector("#previous-day").addEventListener("click", () => navigate(shiftDate(state.date, -1)));
  document.querySelector("#next-day").addEventListener("click", () => navigate(shiftDate(state.date, 1)));
  document.querySelector("#return-today").addEventListener("click", () => navigate(toLocalISODate(new Date())));
  document.querySelector("#fill-yesterday").addEventListener("click", () => navigate(shiftDate(toLocalISODate(new Date()), -1)));
  document.querySelector("#confirm-day").addEventListener("click", () => {
    refreshCalendar();
    recordCurrentDay();
    dirty = true;
    render();
    void saveState();
  });

  elements.phaseDefaults.addEventListener("click", () => {
    refreshCalendar();
    applyPhaseDefaults();
    dirty = true;
    render();
    void saveState();
    showToast("已恢复当前重点默认值");
  });
  elements.form.addEventListener("focusin", refreshCalendar);
  window.addEventListener("focus", refreshCalendar);
  window.addEventListener("pageshow", refreshCalendar);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshCalendar();
    else if (dirty) void saveState();
  });
  window.addEventListener("pagehide", () => { if (dirty) void saveState(); });
  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (event.key === STORAGE_KEY && event.newValue === baselineRaw) return;
    if (dirty || conflict) {
      conflict = true;
      showSaveProblem("另一窗口已更新；请导出本页备份后刷新");
    } else {
      const saved = loadState();
      if (!unreadableStorage) {
        state = buildInitialState(saved, toLocalISODate(new Date()));
        observedToday = toLocalISODate(new Date());
        fillForm(state);
        render(true);
        if (!localDiaryTotalCorrection) elements.saveStatus.textContent = "已同步另一窗口的数据";
      }
    }
  });
  elements.download.addEventListener("click", downloadPoster);
  elements.install.addEventListener("click", installApp);

  if (window.matchMedia("(display-mode: standalone)").matches) {
    elements.install.hidden = true;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    elements.install.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    elements.install.hidden = true;
    showToast("mantou 定投清单已安装");
  });
}

function fillForm(state) {
  elements.date.value = state.date;
  elements.date.min = "0001-01-01";
  elements.date.max = observedToday;
  elements.bodyPhase.value = state.bodyPhase;
  elements.bodyMeta.value = state.bodyMeta;
  elements.readingPhase.value = state.readingPhase;
  elements.readingTarget.textContent = `每日计划 ${Number(config.readingTargetMinutes) || 90} 分钟 · 每周保底 ${((Number(config.weeklyReadingTargetMinutes) || 450) / 60).toFixed(1)} 小时`;
  syncReadingSlider(state.readingMinutes);
  syncTrainingOptions();
  const trial = config.trainingTrial;
  const plan = config.trainingPlan;
  const ongoing = state.date >= plan.start;
  elements.trainingTrialPeriod.textContent = ongoing
    ? `${plan.start} 起 · 持续阶段；上期试行 ${trial.start} — ${trial.end}（已复盘）`
    : `${trial.start} — ${trial.end} · ${trainingTrialStatus(state.date)}`;
  elements.trainingTrialStatus.textContent = ongoing ? plan.label : `两周试行 · ${trainingTrialStatus(state.date)}`;
  elements.trainingTrialSchedule.textContent = ongoing
    ? `每周${Number(config.weeklyStrengthTarget) || 3}次力量训练 · ${plan.schedule}`
    : "上期安排：每周2次力量训练 · 周末一次羽毛球";
  elements.diaryDone.checked = state.diaryDone;
  elements.diaryDay.value = state.diaryDay;
  elements.nextResult.value = state.nextResult;
  elements.nextResultDate.value = state.nextResultDate;
  elements.nextResult2.value = state.nextResult2;
  elements.nextResultDate2.value = state.nextResultDate2;
  elements.nextResult3.value = state.nextResult3;
  elements.nextResultDate3.value = state.nextResultDate3;
  elements.motto.value = state.motto;
  elements.posterTitle.value = state.posterTitle;
  elements.readingLabel.value = state.readingLabel;
  elements.trainingLabel.value = state.trainingLabel;
  elements.diaryLabel.value = state.diaryLabel;
  elements.customTrainingOptions.value = state.customTrainingOptions;
  syncDisplayLabels();
}

function syncDisplayLabels() {
  const reading = state.readingLabel || config.readingLabel;
  const training = state.trainingLabel || config.trainingLabel;
  const diary = state.diaryLabel || config.diaryLabel;
  elements.readingName.textContent = reading;
  const day = state.date === observedToday ? "今日" : "当日";
  elements.trainingName.textContent = training === "训练记录" ? `${day}训练` : `${day}${training}`;
  elements.diaryName.textContent = diary === "日记" ? `${day}已写日记` : `${day}${diary}已完成`;
  elements.diaryDayName.textContent = diary === "日记" ? "累计有效日记天数" : `累计${diary}天数`;
  elements.readingMinutes.setAttribute("aria-label", `${reading}分钟`);
}

function syncTrainingOptions() {
  const control = elements.trainingStatus;
  // A real select is populated here; test harnesses without DOM option APIs
  // can still exercise the state and rendering logic independently.
  if (typeof control.replaceChildren !== "function") return;
  const options = [...new Set([...TRAINING_STATUSES, ...parseTrainingOptions(state.customTrainingOptions)])];
  // Preserve a previously recorded option even after it was removed from presets.
  if (isTrainingStatus(state.trainingStatus) && !options.includes(state.trainingStatus)) options.push(state.trainingStatus);
  control.replaceChildren(...options.map((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    return option;
  }));
  control.value = state.trainingStatus;
}

function syncReadingSlider(value = elements.readingMinutes.value) {
  const minutes = normalizeReadingMinutes(value);
  elements.readingMinutes.max = minutes > 180 ? "360" : "180";
  elements.readingMinutes.step = minutes % 5 === 0 ? "5" : "1";
  const min = Number(elements.readingMinutes.min) || 0;
  const max = Number(elements.readingMinutes.max) || 180;
  const progress = max > min ? ((minutes - min) / (max - min)) * 100 : 0;
  elements.readingMinutes.value = String(minutes);
  elements.readingMinutesValue.textContent = `${minutes} 分钟`;
  elements.readingMinutes.setAttribute("aria-valuetext", `${minutes} 分钟`);
  elements.readingMinutes.style.setProperty("--slider-progress", `${progress}%`);
}

function render(immediate = false) {
  renderDateControls();
  clearTimeout(previewTimer);
  if (immediate) {
    renderPreviews();
    return;
  }
  previewTimer = setTimeout(renderPreviews, 100);
}

function renderDateControls() {
  const isToday = state.date === observedToday;
  const recorded = Object.hasOwn(state.dailyLog, state.date);
  document.querySelector("#record-date-status").textContent = `${isToday ? "今天" : `正在补记 ${state.date}`} · ${recorded ? "已有记录" : "待记录"}`;
  document.querySelector("#next-day").disabled = state.date >= observedToday;
  document.querySelector("#previous-day").disabled = state.date <= "0001-01-01";
  document.querySelector("#return-today").hidden = isToday;
  document.querySelector("#confirm-day").hidden = recorded;
  document.querySelector("#fill-yesterday").hidden = !isToday || Object.hasOwn(state.dailyLog, shiftDate(observedToday, -1));
  document.querySelector("#daily-legend").textContent = isToday ? "今日记录" : `${state.date} 的记录`;
  syncDisplayLabels();
  const heading = document.querySelector("#mobile-form-title");
  if (heading) heading.textContent = isToday ? "记录今天" : "补记过去";
}

function renderPreviews() {
  elements.previewForest.src = createPosterDataUrl();
}

function getFormState() {
  // Rendering and exporting must never edit logs, dates, or diary totals.
  return structuredClone(state);
}

function completedDiaryDays() {
  return countDiaryDays(state.dailyLog);
}

function recordCurrentDay() {
  state.dailyLog[state.date] = {
    readingMinutes: state.readingMinutes,
    trainingStatus: state.trainingStatus,
    diaryDone: state.diaryDone
  };
  state.weekLog = sanitizeWeekLog(state.dailyLog, state.weekKey);
  state.diaryDay = state.diaryBase + completedDiaryDays();
}

function selectDate(date) {
  const daily = state.dailyLog[date] || {};
  state.date = date;
  state.weekKey = getWeekKey(date);
  state.weekLog = sanitizeWeekLog(state.dailyLog, state.weekKey);
  state.readingMinutes = normalizeReadingMinutes(daily.readingMinutes);
  state.trainingStatus = normalizeTrainingStatus(daily.trainingStatus);
  state.diaryDone = daily.diaryDone === true;
  fillForm(state);
}

function scheduleCalendarCheck() {
  clearTimeout(calendarTimer);
  const next = new Date();
  next.setHours(24, 0, 0, 30);
  calendarTimer = setTimeout(refreshCalendar, Math.max(1, next.getTime() - Date.now()));
}

function refreshCalendar() {
  const today = toLocalISODate(new Date());
  if (today === observedToday) return false;
  const selected = state.date;
  const followToday = selected === observedToday;
  state = buildInitialState(state, today);
  observedToday = today;
  if (!followToday) selectDate(selected);
  else fillForm(state);
  dirty = true;
  render(true);
  queueSave();
  scheduleCalendarCheck();
  showToast("日期已更新；累计日记天数已保留");
  return true;
}

function showSaveProblem(message) {
  elements.saveStatus.textContent = message;
}

function queueSave() {
  if (!conflict && !unreadableStorage) elements.saveStatus.textContent = "正在保存…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveState(); }, 280);
}

function withStorageLock(callback) {
  // Web Locks serializes the check-and-write across tabs, not just this page.
  // Older browsers still get a synchronous latest-value guard.
  return navigator.locks ? navigator.locks.request(STORAGE_KEY, callback) : Promise.resolve().then(callback);
}

function saveState() {
  clearTimeout(saveTimer);
  pendingWrite = pendingWrite.catch(() => {}).then(() => withStorageLock(() => {
    if (conflict || unreadableStorage) return false;
    try {
      const latest = localStorage.getItem(STORAGE_KEY);
      if (latest !== baselineRaw) {
        conflict = true;
        showSaveProblem("另一窗口已更新；请导出本页备份后刷新");
        return false;
      }
      const raw = JSON.stringify(getFormState());
      localStorage.setItem(STORAGE_KEY, raw);
      baselineRaw = raw;
      dirty = false;
      elements.saveStatus.textContent = "已自动保存";
      return true;
    } catch {
      showSaveProblem("本机保存失败；请先导出备份，当前填写仍可下载");
      return false;
    }
  })).catch(() => {
    showSaveProblem("本机保存失败；请先导出备份，当前填写仍可下载");
    return false;
  });
  return pendingWrite;
}

function showDiaryTotalCorrection(correction) {
  localDiaryTotalCorrection = correction;
  const message = correction
    ? `旧清单已载入；累计日记按完成记录从 ${correction.from} 校正为 ${correction.to}` : "";
  elements.dataNotice.hidden = !correction;
  elements.dataNotice.textContent = message;
  if (correction) elements.saveStatus.textContent = message;
}

function loadState() {
  try {
    baselineRaw = localStorage.getItem(STORAGE_KEY);
    const loaded = baselineRaw ? parseLocalState(JSON.parse(baselineRaw)) : null;
    unreadableStorage = false;
    showDiaryTotalCorrection(loaded?.diaryTotalCorrection || null);
    return loaded?.state || null;
  } catch {
    unreadableStorage = true;
    showSaveProblem("本机数据无法读取；未覆盖原数据，仍可填写和导出");
    return null;
  }
}

async function restoreState(candidate) {
  const validated = parseBackup(candidate);
  clearTimeout(saveTimer);
  await pendingWrite;
  return withStorageLock(() => {
    if (conflict || unreadableStorage || localStorage.getItem(STORAGE_KEY) !== baselineRaw) {
      conflict = true;
      showSaveProblem("另一窗口已更新或本机数据不可读；请先导出备份后刷新");
      throw new Error("无法安全恢复，请先导出当前备份并刷新页面");
    }
    const restored = buildInitialState(validated, toLocalISODate(new Date()));
    try {
      // If either write fails, keep the current UI unchanged. The primary setItem
      // is atomic; a successfully written recovery remains available on failure.
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(makeBackup(getFormState())));
      const raw = JSON.stringify(restored);
      localStorage.setItem(STORAGE_KEY, raw);
      baselineRaw = raw;
    } catch {
      showSaveProblem("恢复未完成；原清单未覆盖，请检查本机存储空间");
      throw new Error("无法保存导入前备份或新数据，未覆盖当前清单");
    }
    state = restored;
    observedToday = toLocalISODate(new Date());
    dirty = false;
    showDiaryTotalCorrection(null);
    fillForm(state);
    render(true);
    scheduleCalendarCheck();
    elements.saveStatus.textContent = "备份已恢复，导入前备份已保留";
    return getFormState();
  });
}

function applyPhaseDefaults() {
  state.bodyPhase = config.bodyPhase;
  state.bodyMeta = config.bodyMeta;
  state.readingPhase = config.readingPhase;
  fillForm(state);
}

async function downloadPoster() {
  refreshCalendar();
  render();
  void saveState();
  elements.download.disabled = true;
  elements.download.textContent = "正在生成…";

  try {
    await document.fonts.ready;
    const dataUrl = createPosterDataUrl();
    const link = document.createElement("a");
    link.download = `${(state.posterTitle || config.posterTitle).replace(/[\\/:*?"<>|]/gu, "").slice(0, 20) || "定投清单"}-${elements.date.value || "今日"}.png`;
    link.href = dataUrl;
    link.click();
    showToast("PNG 已生成并下载");
  } catch (error) {
    console.error(error);
    showToast("生成失败，请刷新页面后重试");
  } finally {
    elements.download.disabled = false;
    elements.download.textContent = "生成并下载 PNG";
  }
}

function createPosterDataUrl() {
  const state = getFormState();
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1536;
  const context = canvas.getContext("2d");
  const fontFamily = "'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif";
  context.textBaseline = "alphabetic";
  drawEvergreenPoster(context, state, fontFamily);
  return canvas.toDataURL("image/png");
}

function drawEvergreenPoster(context, state, fontFamily) {
  const theme = {
    primary: "#a84e32",
    dark: "#292824",
    paper: "#fffaf1",
    ink: "#292824",
    muted: "#6b6258",
    line: "#d9cebe",
    soft: "#e5e0d3",
    gold: "#71523f",
    white: "#fffcf7"
  };
  const stats = getWeeklyStats(state);
  const readingTarget = Number(config.readingTargetMinutes) || 90;
  const weeklyReadingTarget = Number(config.weeklyReadingTargetMinutes) || 450;
  const weeklyStrengthTarget = Number(config.weeklyStrengthTarget) || 2;
  const diaryText = state.diaryDone ? "✓ 已完成" : "— 待完成";

  context.fillStyle = theme.paper;
  context.fillRect(0, 0, 1080, 1536);
  drawFitText(context, formatDisplayDate(state.date), 1008, 80, 320, 28, 600, fontFamily, theme.muted, "right");
  // Keep the existing vector wordmark inline with the Chinese title, at its natural aspect ratio.
  const posterTitle = state.posterTitle || config.posterTitle;
  if (posterTitle === "mantou 定投清单") {
    drawIdentity(context, "wordmark", 72, 125, 244, 56);
    drawFitText(context, "定投清单", 334, 177, 553, 60, 700, fontFamily, theme.ink);
  } else {
    drawFitText(context, posterTitle, 72, 177, 850, 60, 700, fontFamily, theme.ink);
  }
  context.fillStyle = "#edc29e";
  context.fillRect(74, 195, 500, 7);
  drawFitText(context, state.motto || config.motto, 72, 249, 850, 28, 400, fontFamily, theme.muted);
  drawIdentity(context, "walker", 935, 142, 54, 98);
  context.fillStyle = theme.line;
  context.fillRect(72, 286, 936, 2);

  setCanvasFont(context, 400, 32, fontFamily);
  const readingLines = wrapReadingText(context, state.readingPhase || "未填写", 740);
  const focusHeight = 248 + Math.max(0, readingLines.length - 2) * 38;
  drawArchiveCard(context, 54, 314, 972, focusHeight, theme.white, theme.primary);
  drawFitText(context, "当前重点", 94, 376, 300, 29, 700, fontFamily, theme.primary);
  drawArchiveRow(context, 94, 432, "主实验", `${state.bodyPhase || "未填写"}${state.bodyMeta ? ` · ${state.bodyMeta}` : ""}`, theme, fontFamily);
  drawFitText(context, "当前阅读", 94, 496, 150, 27, 600, fontFamily, theme.muted);
  readingLines.forEach((line, index) => {
    drawFitText(context, line, 264, 496 + index * 38, 740, 32, 400, fontFamily, theme.ink);
  });

  const todayY = 314 + focusHeight + 28;
  drawArchiveCard(context, 54, todayY, 972, 290, "#edf0e3", theme.primary);
  drawFitText(context, "今日积累", 94, todayY + 62, 300, 29, 700, fontFamily, theme.primary);
  drawFitText(context, state.readingLabel || config.readingLabel, 94, todayY + 124, 150, 27, 600, fontFamily, theme.muted);
  drawFitText(context, `${state.readingMinutes} 分钟`, 264, todayY + 124, 330, 36, 700, fontFamily, theme.ink);
  drawFitText(context, `计划 ${readingTarget} 分钟`, 620, todayY + 124, 350, 26, 400, fontFamily, theme.muted);
  drawArchiveRow(context, 94, todayY + 190, state.trainingLabel || config.trainingLabel, state.trainingStatus, theme, fontFamily);
  drawFitText(context, state.diaryLabel || config.diaryLabel, 94, todayY + 256, 150, 27, 600, fontFamily, theme.muted);
  drawFitText(context, diaryText, 264, todayY + 256, 330, 36, 700, fontFamily, theme.ink);
  drawFitText(context, `累计有效 ${state.diaryDay} 天`, 620, todayY + 256, 350, 26, 400, fontFamily, theme.muted);

  const weekY = todayY + 318;
  drawArchiveCard(context, 54, weekY, 972, 230, "#f5e8de", theme.gold);
  drawFitText(context, "本周投入", 94, weekY + 62, 300, 29, 700, fontFamily, theme.gold);
  drawFitText(context, `${state.readingLabel || config.readingLabel} · 保底`, 94, weekY + 116, 460, 24, 600, fontFamily, theme.muted);
  drawFitText(context, `${(stats.readingMinutes / 60).toFixed(1)} / ${(weeklyReadingTarget / 60).toFixed(1)} 小时`, 94, weekY + 164, 390, 36, 700, fontFamily, theme.ink);
  drawProgressBar(context, 94, weekY + 194, 390, 14, stats.readingMinutes, weeklyReadingTarget, theme);
  drawFitText(context, "力量训练", 586, weekY + 116, 220, 24, 600, fontFamily, theme.muted);
  drawFitText(context, `${stats.strengthCount} / ${weeklyStrengthTarget} 次`, 586, weekY + 164, 300, 36, 700, fontFamily, theme.ink);
  drawProgressBar(context, 586, weekY + 194, 330, 14, stats.strengthCount, weeklyStrengthTarget, theme);

  const deliverables = [
    { value: state.nextResult, status: state.nextResultDate },
    { value: state.nextResult2, status: state.nextResultDate2 },
    { value: state.nextResult3, status: state.nextResultDate3 }
  ].filter((item) => item.value.trim());

  if (deliverables.length) {
    const resultsY = weekY + 258;
    const resultsHeight = 70 + deliverables.length * 48;
    drawArchiveCard(context, 54, resultsY, 972, resultsHeight, theme.white, theme.gold);
    drawFitText(context, "本周交付物", 94, resultsY + 50, 300, 27, 700, fontFamily, theme.gold);
    deliverables.forEach((item, index) => {
      drawResultRow(context, 94, resultsY + 94 + index * 45, String(index + 1).padStart(2, "0"), item.value, item.status, theme, fontFamily);
    });
  }

  context.fillStyle = theme.line;
  context.fillRect(72, 1484, 936, 2);
  drawFitText(context, "mantou 定投清单 · 每天一点，慢慢向前。", 72, 1520, 936, 27, 700, fontFamily, theme.muted);
}

function wrapReadingText(context, text, maxWidth, maxLines = 4) {
  const lines = [];
  for (const paragraph of String(text).split(/\r?\n/).filter((line) => line.trim())) {
    let line = "";
    for (const token of paragraph.trim().match(/[A-Za-z0-9]+|[^A-Za-z0-9]/gu) || []) {
      for (const part of context.measureText(token).width > maxWidth ? [...token] : [token]) {
        if (line && context.measureText(line + part).width > maxWidth) {
          lines.push(line.trimEnd());
          line = part.trimStart();
        } else line += part;
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = [...lines[maxLines - 1]];
    while (last.length && context.measureText(last.join("") + "…").width > maxWidth) last.pop();
    lines[maxLines - 1] = last.join("") + "…";
  }
  return lines;
}

function drawArchiveCard(context, x, y, width, height, fill, accent) {
  drawRoundedFill(context, x, y, width, height, 18, fill);
  context.fillStyle = accent;
  context.fillRect(x + 22, y + 27, 5, 32);
}

function drawArchiveRow(context, x, baseline, label, value, theme, fontFamily) {
  drawFitText(context, label, x, baseline, 150, 27, 600, fontFamily, theme.muted);
  drawFitText(context, value, x + 170, baseline, 740, 34, 400, fontFamily, theme.ink);
}

function drawResultRow(context, x, baseline, index, value, status, theme, fontFamily) {
  drawFitText(context, index, x, baseline, 44, 24, 700, fontFamily, theme.gold);
  drawFitText(context, value, x + 58, baseline, 630, 28, 600, fontFamily, theme.ink);
  drawFitText(context, status, x + 884, baseline, 170, 23, 600, fontFamily, status === "已通过" ? theme.primary : theme.muted, "right");
}

function drawProgressBar(context, x, y, width, height, value, target, theme) {
  drawRoundedFill(context, x, y, width, height, height / 2, theme.soft);
  const ratio = target > 0 ? Math.min(1, Math.max(0, Number(value) / Number(target))) : 0;
  if (ratio > 0) drawRoundedFill(context, x, y, Math.max(height, width * ratio), height, height / 2, theme.primary);
}

function drawRoundedFill(context, x, y, width, height, radius, color) {
  context.fillStyle = color;
  roundedRect(context, x, y, width, height, radius);
  context.fill();
}

function drawFitText(context, text, x, y, maxWidth, size, weight, family, color, align = "left") {
  let fittedSize = size;
  setCanvasFont(context, weight, fittedSize, family);
  while (context.measureText(String(text)).width > maxWidth && fittedSize > 20) {
    fittedSize -= 2;
    setCanvasFont(context, weight, fittedSize, family);
  }
  context.fillStyle = color;
  context.textAlign = align;
  context.fillText(String(text), x, y, maxWidth);
  context.textAlign = "left";
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function setCanvasFont(context, weight, size, family) {
  context.font = `${weight} ${size}px ${family}`;
}

async function installApp() {
  if (window.matchMedia("(display-mode: standalone)").matches) {
    showToast("mantou 定投清单已作为应用运行");
    return;
  }
  if (!installPrompt) {
    showToast(getInstallHelpMessage());
    return;
  }
  installPrompt.prompt();
  const choice = await installPrompt.userChoice;
  installPrompt = null;
  if (choice.outcome === "accepted") elements.install.hidden = true;
}

function getInstallHelpMessage() {
  const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return isIOS
    ? "请使用 Safari 的“分享”→“添加到主屏幕”，安装 mantou 定投清单"
    : "请打开浏览器菜单，选择“安装应用”或“添加到主屏幕”，安装 mantou 定投清单";
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const hadController = Boolean(navigator.serviceWorker.controller);
  let refreshing = false;

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController || refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  navigator.serviceWorker.register("./sw.js")
    .then((registration) => registration.update())
    .catch((error) => {
      console.warn("Service worker registration failed", error);
    });
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  setTimeout(() => elements.toast.classList.remove("visible"), 2400);
}

function getWeeklyStats(state) {
  const records = Object.values(state.weekLog || {});
  return {
    readingMinutes: records.reduce((sum, item) => sum + clamp(item?.readingMinutes, 0, 360), 0),
    strengthCount: records.filter((item) => normalizeTrainingStatus(item?.trainingStatus) === "力量训练").length
  };
}


function trainingTrialStatus(date) {
  const { start, end } = config.trainingTrial;
  return date < start ? "待开始" : date > end ? "待复盘" : "试行中";
}

function migrateLegacyText(value, oldDefaults, newDefault) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || oldDefaults.includes(text)) return newDefault;
  return text;
}

function normalizeReadingMinutes(value) {
  return Math.trunc(clamp(value, 0, 360));
}

function normalizeTrainingStatus(value) {
  return isTrainingStatus(value) ? value : "未训练";
}

function normalizeAcceptanceStatus(value) {
  return ["待验收", "已通过"].includes(value) ? value : "待验收";
}


function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${year}.${month}.${day}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

