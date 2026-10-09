import { STORAGE_KEY, RECOVERY_KEY, getWeekKey, weekEnd, toLocalISODate, isISODate, sanitizeWeekLog, parseBackup, parseLocalState, makeBackup } from "./state.js";
import { drawIdentity } from "./identity.js";

const fallbackConfig = {
  diaryDay: 1291,
  bodyPhase: "作息重构实验 V1",
  bodyMeta: "5:00–8:00",
  investmentPhase: "主动投资系统建设中",
  readingPhase: "认知类书籍",
  readingTargetMinutes: 90,
  weeklyReadingTargetMinutes: 450,
  weeklyStrengthTarget: 3,
  trainingStatus: "未训练",
  nextResult: "完成14天 V1 验收",
  nextResultDate: "待验收",
  nextResult2: "",
  nextResultDate2: "待验收",
  nextResult3: "",
  nextResultDate3: "待验收",
  motto: "把时间转化为能力、资本与自主权。"
};

const config = await loadConfig();

const elements = {
  form: document.querySelector("#checklist-form"),
  date: document.querySelector("#date"),
  bodyPhase: document.querySelector("#body-phase"),
  bodyMeta: document.querySelector("#body-meta"),
  investmentPhase: document.querySelector("#investment-phase"),
  readingPhase: document.querySelector("#reading-phase"),
  readingMinutes: document.querySelector("#reading-minutes"),
  readingMinutesValue: document.querySelector("#reading-minutes-value"),
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
  const weekLog = saved?.weekKey === currentWeek ? sanitizeWeekLog(saved?.weekLog, currentWeek) : {};
  if (isISODate(saved?.date) && getWeekKey(saved.date) === currentWeek && !weekLog[saved.date]) {
    weekLog[saved.date] = {
      readingMinutes: normalizeReadingMinutes(saved.readingMinutes),
      trainingStatus: normalizeTrainingStatus(saved.trainingStatus),
      diaryDone: saved.diaryDone === true
    };
  }
  const daily = weekLog[today] || {};
  const sameDay = saved?.date === today;

  return {
    date: today,
    bodyPhase: migrateLegacyText(saved?.bodyPhase, ["减脂收官", "精干强健计划"], config.bodyPhase),
    bodyMeta: migrateLegacyText(saved?.bodyMeta, ["9.19验收", "持续期"], config.bodyMeta),
    investmentPhase: saved?.investmentPhase || config.investmentPhase,
    readingPhase: migrateLegacyText(saved?.readingPhase, ["Beyond Feelings · W1"], config.readingPhase),
    readingMinutes: sameDay && saved?.readingMinutes !== undefined
      ? normalizeReadingMinutes(saved.readingMinutes)
      : normalizeReadingMinutes(daily.readingMinutes),
    trainingStatus: sameDay && saved?.trainingStatus
      ? normalizeTrainingStatus(saved.trainingStatus)
      : normalizeTrainingStatus(daily.trainingStatus || config.trainingStatus),
    diaryDone: sameDay && saved?.diaryDone !== undefined ? saved.diaryDone : Boolean(daily.diaryDone),
    diaryDay: Math.max(0, Number(saved?.diaryDay ?? config.diaryDay) || 0),
    weekKey: currentWeek,
    weekLog,
    nextResult: migrateLegacyText(saved?.nextResult, ["批判性判断框架 v0.1"], config.nextResult),
    nextResultDate: normalizeAcceptanceStatus(saved?.nextResultDate || config.nextResultDate),
    nextResult2: saved?.nextResult2 || config.nextResult2,
    nextResultDate2: normalizeAcceptanceStatus(saved?.nextResultDate2 || config.nextResultDate2),
    nextResult3: saved?.nextResult3 || config.nextResult3,
    nextResultDate3: normalizeAcceptanceStatus(saved?.nextResultDate3 || config.nextResultDate3),
    motto: saved?.motto || config.motto
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
      state.diaryDay = Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, state.diaryDay + Number(value) - Number(state.diaryDone)));
    }
    state[field] = field === "readingMinutes" ? normalizeReadingMinutes(value)
      : field === "diaryDay" ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(completedDiaryDays(), Math.trunc(Number(value) || 0)))
      : typeof value === "string" ? value.trim() : value;
    recordCurrentDay();
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
    if (!isISODate(nextDate) || getWeekKey(nextDate) !== getWeekKey(observedToday)) {
      elements.date.value = state.date;
      showToast("只支持查看和补记本周日期，已有记录未改变");
      return;
    }
    selectDate(nextDate);
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
    showToast("已恢复当前阶段默认值");
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
  elements.date.min = getWeekKey(observedToday);
  elements.date.max = weekEnd(elements.date.min);
  elements.bodyPhase.value = state.bodyPhase;
  elements.bodyMeta.value = state.bodyMeta;
  elements.investmentPhase.value = state.investmentPhase;
  elements.readingPhase.value = state.readingPhase;
  syncReadingSlider(state.readingMinutes);
  elements.trainingStatus.value = state.trainingStatus;
  elements.diaryDone.checked = state.diaryDone;
  elements.diaryDay.value = state.diaryDay;
  elements.nextResult.value = state.nextResult;
  elements.nextResultDate.value = state.nextResultDate;
  elements.nextResult2.value = state.nextResult2;
  elements.nextResultDate2.value = state.nextResultDate2;
  elements.nextResult3.value = state.nextResult3;
  elements.nextResultDate3.value = state.nextResultDate3;
  elements.motto.value = state.motto;
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
  clearTimeout(previewTimer);
  if (immediate) {
    renderPreviews();
    return;
  }
  previewTimer = setTimeout(renderPreviews, 100);
}

function renderPreviews() {
  elements.previewForest.src = createPosterDataUrl();
}

function getFormState() {
  // Rendering and exporting must never edit logs, dates, or diary totals.
  return structuredClone(state);
}

function completedDiaryDays() {
  return Object.values(state.weekLog).filter((daily) => daily.diaryDone).length;
}

function recordCurrentDay() {
  state.weekLog[state.date] = {
    readingMinutes: state.readingMinutes,
    trainingStatus: state.trainingStatus,
    diaryDone: state.diaryDone
  };
}

function selectDate(date) {
  const daily = state.weekLog[date] || {};
  state.date = date;
  state.readingMinutes = normalizeReadingMinutes(daily.readingMinutes);
  state.trainingStatus = normalizeTrainingStatus(daily.trainingStatus || config.trainingStatus);
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
  const followToday = selected === observedToday || getWeekKey(selected) !== getWeekKey(today);
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
    link.download = `mantou 定投清单-${elements.date.value || "今日"}.png`;
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
  const weeklyStrengthTarget = Number(config.weeklyStrengthTarget) || 3;
  const diaryText = state.diaryDone ? "✓ 已完成" : "— 待完成";

  context.fillStyle = theme.paper;
  context.fillRect(0, 0, 1080, 1536);
  drawIdentity(context, "wordmark", 72, 43, 196, 51);
  drawFitText(context, formatDisplayDate(state.date), 1008, 80, 320, 28, 600, fontFamily, theme.muted, "right");
  drawFitText(context, "mantou 定投清单", 72, 177, 815, 60, 700, fontFamily, theme.ink);
  context.fillStyle = "#edc29e";
  context.fillRect(74, 195, 476, 7);
  drawFitText(context, state.motto || config.motto, 72, 249, 850, 28, 400, fontFamily, theme.muted);
  drawIdentity(context, "walker", 935, 142, 54, 98);
  context.fillStyle = theme.line;
  context.fillRect(72, 286, 936, 2);

  drawArchiveCard(context, 54, 314, 972, 280, theme.white, theme.primary);
  drawFitText(context, "阶段推进", 94, 376, 300, 29, 700, fontFamily, theme.primary);
  drawArchiveRow(context, 94, 438, "主实验", `${state.bodyPhase || "未填写"}${state.bodyMeta ? ` · ${state.bodyMeta}` : ""}`, theme, fontFamily);
  drawArchiveRow(context, 94, 502, "投资", state.investmentPhase || "未填写", theme, fontFamily);
  drawArchiveRow(context, 94, 566, "当前阅读", state.readingPhase || "未填写", theme, fontFamily);

  drawArchiveCard(context, 54, 630, 972, 310, "#edf0e3", theme.primary);
  drawFitText(context, "今日积累", 94, 692, 300, 29, 700, fontFamily, theme.primary);
  drawArchiveRow(context, 94, 760, "破界行动", `${state.readingMinutes} 分钟 · 目标 ≥ ${readingTarget}`, theme, fontFamily);
  drawArchiveRow(context, 94, 834, "训练", state.trainingStatus, theme, fontFamily);
  drawArchiveRow(context, 94, 908, "日记", `${diaryText} · 累计有效 ${state.diaryDay} 天`, theme, fontFamily);

  drawArchiveCard(context, 54, 976, 972, 250, "#f5e8de", theme.gold);
  drawFitText(context, "本周进度", 94, 1038, 300, 29, 700, fontFamily, theme.gold);
  drawFitText(context, "破界行动", 94, 1102, 260, 24, 600, fontFamily, theme.muted);
  drawFitText(context, `${(stats.readingMinutes / 60).toFixed(1)} / ${(weeklyReadingTarget / 60).toFixed(1)} 小时`, 94, 1150, 390, 36, 700, fontFamily, theme.ink);
  drawProgressBar(context, 94, 1180, 390, 14, stats.readingMinutes, weeklyReadingTarget, theme);
  drawFitText(context, "力量训练", 586, 1102, 220, 24, 600, fontFamily, theme.muted);
  drawFitText(context, `${stats.strengthCount} / ${weeklyStrengthTarget} 次`, 586, 1150, 300, 36, 700, fontFamily, theme.ink);
  drawProgressBar(context, 586, 1180, 330, 14, stats.strengthCount, weeklyStrengthTarget, theme);

  const deliverables = [
    { value: state.nextResult, status: state.nextResultDate },
    { value: state.nextResult2, status: state.nextResultDate2 },
    { value: state.nextResult3, status: state.nextResultDate3 }
  ].filter((item) => item.value.trim());

  const resultsHeight = 70 + Math.max(1, deliverables.length) * 48;
  drawArchiveCard(context, 54, 1250, 972, resultsHeight, theme.white, theme.gold);
  drawFitText(context, "本周交付物", 94, 1300, 300, 27, 700, fontFamily, theme.gold);
  if (deliverables.length) {
    deliverables.forEach((item, index) => {
      drawResultRow(context, 94, 1344 + index * 45, String(index + 1).padStart(2, "0"), item.value, item.status, theme, fontFamily);
    });
  } else {
    drawFitText(context, "暂无", 94, 1344, 240, 25, 700, fontFamily, theme.muted);
  }

  context.fillStyle = theme.line;
  context.fillRect(72, 1484, 936, 2);
  drawFitText(context, "每天一点，慢慢向前。", 72, 1520, 850, 27, 700, fontFamily, theme.muted);
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


function migrateLegacyText(value, oldDefaults, newDefault) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || oldDefaults.includes(text)) return newDefault;
  return text;
}

function normalizeReadingMinutes(value) {
  return Math.trunc(clamp(value, 0, 360));
}

function normalizeTrainingStatus(value) {
  return ["力量训练", "激活", "恢复", "未训练"].includes(value) ? value : "未训练";
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

