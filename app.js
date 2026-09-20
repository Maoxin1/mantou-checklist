const STORAGE_KEY = "personal-investment-checklist:v1";

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
  toast: document.querySelector("#toast"),
  previewForest: document.querySelector("#preview-forest")
};

let installPrompt = null;
let saveTimer = null;
let previewTimer = null;
let lastDiaryDone = false;
let activeDiaryDate = "";
let activeWeekKey = "";
let weeklyLog = {};

window.checklistExporter = { toDataUrl: createPosterDataUrl };
window.checklistStorage = {
  key: STORAGE_KEY,
  save() {
    saveState();
    return getFormState();
  },
  restore(state) {
    clearTimeout(saveTimer);
    clearTimeout(previewTimer);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const restored = buildInitialState(state, toLocalISODate(new Date()));
    weeklyLog = { ...restored.weekLog };
    activeWeekKey = restored.weekKey;
    fillForm(restored);
    lastDiaryDone = restored.diaryDone;
    activeDiaryDate = restored.date;
    render(true);
    saveState();
    return restored;
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
  const today = toLocalISODate(new Date());
  const saved = loadState();
  const state = buildInitialState(saved, today);
  weeklyLog = { ...state.weekLog };
  activeWeekKey = state.weekKey;
  fillForm(state);
  lastDiaryDone = state.diaryDone;
  activeDiaryDate = state.date;
  render(true);
  bindEvents();
  registerServiceWorker();
}

function buildInitialState(saved, today) {
  const currentWeek = getWeekKey(today);
  const weekLog = saved?.weekKey === currentWeek ? sanitizeWeekLog(saved?.weekLog) : {};
  const daily = weekLog[today] || {};
  const sameDay = saved?.date === today;

  return {
    date: today,
    bodyPhase: migrateLegacyText(saved?.bodyPhase, ["减脂收官", "精干强健计划"], config.bodyPhase),
    bodyMeta: migrateLegacyText(saved?.bodyMeta, ["9.19验收", "持续期"], config.bodyMeta),
    investmentPhase: saved?.investmentPhase || config.investmentPhase,
    readingPhase: migrateLegacyText(saved?.readingPhase, ["Beyond Feelings · W1"], config.readingPhase),
    readingMinutes: sameDay && saved?.readingMinutes !== undefined
      ? clamp(saved.readingMinutes, 0, 360)
      : clamp(daily.readingMinutes, 0, 360),
    trainingStatus: sameDay && saved?.trainingStatus
      ? normalizeTrainingStatus(saved.trainingStatus)
      : normalizeTrainingStatus(daily.trainingStatus || config.trainingStatus),
    diaryDone: sameDay ? Boolean(saved?.diaryDone) : Boolean(daily.diaryDone),
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
  elements.form.addEventListener("input", () => {
    render();
    queueSave();
  });

  elements.date.addEventListener("change", () => {
    const nextDate = elements.date.value || toLocalISODate(new Date());
    const nextWeek = getWeekKey(nextDate);
    if (nextWeek !== activeWeekKey) {
      weeklyLog = {};
      activeWeekKey = nextWeek;
    }
    const daily = weeklyLog[nextDate] || {};
    elements.readingMinutes.value = clamp(daily.readingMinutes, 0, 360);
    elements.trainingStatus.value = normalizeTrainingStatus(daily.trainingStatus || config.trainingStatus);
    elements.diaryDone.checked = Boolean(daily.diaryDone);
    lastDiaryDone = elements.diaryDone.checked;
    activeDiaryDate = nextDate;
    render();
    saveState();
  });

  elements.diaryDone.addEventListener("change", updateDiaryTotal);
  elements.phaseDefaults.addEventListener("click", () => {
    applyPhaseDefaults();
    render();
    saveState();
    showToast("已恢复当前阶段默认值");
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
    showToast("已安装到手机");
  });
}

function fillForm(state) {
  elements.date.value = state.date;
  elements.bodyPhase.value = state.bodyPhase;
  elements.bodyMeta.value = state.bodyMeta;
  elements.investmentPhase.value = state.investmentPhase;
  elements.readingPhase.value = state.readingPhase;
  elements.readingMinutes.value = state.readingMinutes;
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
  const date = elements.date.value || toLocalISODate(new Date());
  const weekKey = getWeekKey(date);
  if (weekKey !== activeWeekKey) {
    weeklyLog = {};
    activeWeekKey = weekKey;
  }

  const readingMinutes = clamp(elements.readingMinutes.value, 0, 360);
  const trainingStatus = normalizeTrainingStatus(elements.trainingStatus.value);
  const diaryDone = elements.diaryDone.checked;

  weeklyLog[date] = { readingMinutes, trainingStatus, diaryDone };

  return {
    date,
    bodyPhase: elements.bodyPhase.value.trim(),
    bodyMeta: elements.bodyMeta.value.trim(),
    investmentPhase: elements.investmentPhase.value.trim(),
    readingPhase: elements.readingPhase.value.trim(),
    readingMinutes,
    trainingStatus,
    diaryDone,
    diaryDay: Math.max(0, Number(elements.diaryDay.value) || 0),
    weekKey,
    weekLog: { ...weeklyLog },
    nextResult: elements.nextResult.value.trim(),
    nextResultDate: elements.nextResultDate.value.trim(),
    nextResult2: elements.nextResult2.value.trim(),
    nextResultDate2: elements.nextResultDate2.value.trim(),
    nextResult3: elements.nextResult3.value.trim(),
    nextResultDate3: elements.nextResultDate3.value.trim(),
    motto: elements.motto.value.trim()
  };
}

function updateDiaryTotal() {
  const current = Math.max(0, Number(elements.diaryDay.value) || 0);
  if (elements.diaryDone.checked && !lastDiaryDone) elements.diaryDay.value = current + 1;
  if (!elements.diaryDone.checked && lastDiaryDone) elements.diaryDay.value = Math.max(0, current - 1);
  lastDiaryDone = elements.diaryDone.checked;
  render();
  saveState();
}

function queueSave() {
  elements.saveStatus.textContent = "正在保存…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 280);
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getFormState()));
  elements.saveStatus.textContent = "已自动保存";
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

function applyPhaseDefaults() {
  elements.bodyPhase.value = config.bodyPhase;
  elements.bodyMeta.value = config.bodyMeta;
  elements.readingPhase.value = config.readingPhase;
}

async function downloadPoster() {
  render();
  saveState();
  elements.download.disabled = true;
  elements.download.textContent = "正在生成…";

  try {
    await document.fonts.ready;
    const dataUrl = createPosterDataUrl();
    const link = document.createElement("a");
    link.download = `个人定投-${elements.date.value || "今日"}.png`;
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
  const fontFamily = "SamsungOne, 'Noto Sans SC', 'Microsoft YaHei', sans-serif";
  context.textBaseline = "alphabetic";
  drawEvergreenPoster(context, state, fontFamily);
  return canvas.toDataURL("image/png");
}

function drawEvergreenPoster(context, state, fontFamily) {
  const theme = {
    primary: "#245c46",
    dark: "#173c2e",
    paper: "#f3f1ea",
    ink: "#19211d",
    muted: "#6c756f",
    line: "#d9ddd7",
    soft: "#e2e7e3",
    gold: "#b28a55",
    white: "#ffffff"
  };
  const stats = getWeeklyStats(state);
  const readingTarget = Number(config.readingTargetMinutes) || 90;
  const weeklyReadingTarget = Number(config.weeklyReadingTargetMinutes) || 450;
  const weeklyStrengthTarget = Number(config.weeklyStrengthTarget) || 3;
  const diaryText = state.diaryDone ? "✓ 已完成" : "— 待完成";

  context.fillStyle = theme.paper;
  context.fillRect(0, 0, 1080, 1536);
  context.fillStyle = theme.primary;
  context.fillRect(0, 0, 1080, 270);

  drawFitText(context, "mantou", 72, 68, 240, 30, 900, fontFamily, theme.white);
  drawFitText(context, formatDisplayDate(state.date), 1008, 68, 320, 30, 800, fontFamily, "#dbe8df", "right");
  drawFitText(context, "个人定投", 72, 166, 640, 72, 900, fontFamily, theme.white);
  drawFitText(context, state.motto || config.motto, 72, 225, 900, 28, 700, fontFamily, "#dbe8df");

  drawArchiveCard(context, 54, 314, 972, 280, theme.white, theme.primary);
  drawFitText(context, "阶段推进", 94, 376, 300, 29, 900, fontFamily, theme.primary);
  drawArchiveRow(context, 94, 452, "主实验", `${state.bodyPhase || "未填写"}${state.bodyMeta ? ` · ${state.bodyMeta}` : ""}`, theme, fontFamily);
  drawArchiveRow(context, 94, 518, "投资", state.investmentPhase || "未填写", theme, fontFamily);
  drawArchiveRow(context, 94, 584, "当前阅读", state.readingPhase || "未填写", theme, fontFamily);

  drawArchiveCard(context, 54, 630, 972, 310, theme.white, theme.primary);
  drawFitText(context, "今日积累", 94, 692, 300, 29, 900, fontFamily, theme.primary);
  drawArchiveRow(context, 94, 772, "阅读", `${state.readingMinutes} 分钟 · 目标 ≥ ${readingTarget}`, theme, fontFamily);
  drawArchiveRow(context, 94, 848, "训练", state.trainingStatus, theme, fontFamily);
  drawArchiveRow(context, 94, 924, "日记", `${diaryText} · 累计有效 ${state.diaryDay} 天`, theme, fontFamily);

  drawArchiveCard(context, 54, 976, 972, 250, theme.white, theme.gold);
  drawFitText(context, "本周进度", 94, 1038, 300, 29, 900, fontFamily, theme.gold);
  drawFitText(context, "高质量阅读", 94, 1102, 260, 24, 800, fontFamily, theme.muted);
  drawFitText(context, `${(stats.readingMinutes / 60).toFixed(1)} / ${(weeklyReadingTarget / 60).toFixed(1)} 小时`, 94, 1150, 390, 36, 900, fontFamily, theme.ink);
  drawProgressBar(context, 94, 1180, 390, 14, stats.readingMinutes, weeklyReadingTarget, theme);
  drawFitText(context, "力量训练", 586, 1102, 220, 24, 800, fontFamily, theme.muted);
  drawFitText(context, `${stats.strengthCount} / ${weeklyStrengthTarget} 次`, 586, 1150, 300, 36, 900, fontFamily, theme.ink);
  drawProgressBar(context, 586, 1180, 330, 14, stats.strengthCount, weeklyStrengthTarget, theme);

  const deliverables = [
    { value: state.nextResult, status: state.nextResultDate },
    { value: state.nextResult2, status: state.nextResultDate2 },
    { value: state.nextResult3, status: state.nextResultDate3 }
  ].filter((item) => item.value.trim());

  const resultsHeight = 70 + Math.max(1, deliverables.length) * 48;
  drawArchiveCard(context, 54, 1250, 972, resultsHeight, theme.white, theme.gold);
  drawFitText(context, "本周交付物", 94, 1300, 300, 27, 900, fontFamily, theme.gold);
  if (deliverables.length) {
    deliverables.forEach((item, index) => {
      drawResultRow(context, 94, 1344 + index * 45, String(index + 1).padStart(2, "0"), item.value, item.status, theme, fontFamily);
    });
  } else {
    drawFitText(context, "暂无", 94, 1344, 240, 25, 700, fontFamily, theme.muted);
  }

  context.fillStyle = theme.line;
  context.fillRect(72, 1484, 936, 2);
  drawFitText(context, "输入事实，让系统负责计算状态。", 72, 1520, 850, 27, 700, fontFamily, theme.muted);
}

function drawArchiveCard(context, x, y, width, height, fill, accent) {
  drawRoundedFill(context, x, y, width, height, 24, fill);
  context.fillStyle = accent;
  context.fillRect(x, y + 28, 7, height - 56);
}

function drawArchiveRow(context, x, baseline, label, value, theme, fontFamily) {
  drawFitText(context, label, x, baseline, 150, 27, 800, fontFamily, theme.muted);
  drawFitText(context, value, x + 170, baseline, 740, 34, 650, fontFamily, theme.ink);
}

function drawResultRow(context, x, baseline, index, value, status, theme, fontFamily) {
  drawFitText(context, index, x, baseline, 44, 24, 900, fontFamily, theme.gold);
  drawFitText(context, value, x + 58, baseline, 630, 28, 800, fontFamily, theme.ink);
  drawFitText(context, status, x + 884, baseline, 170, 23, 800, fontFamily, status === "已通过" ? theme.primary : theme.muted, "right");
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
    showToast("编辑器已作为应用运行");
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
    ? "请使用 Safari 的“分享”，选择“添加到主屏幕”"
    : "请打开浏览器菜单，选择“安装应用”或“添加到主屏幕”";
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

function sanitizeWeekLog(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [date, item] of Object.entries(value)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !item || typeof item !== "object") continue;
    result[date] = {
      readingMinutes: clamp(item.readingMinutes, 0, 360),
      trainingStatus: normalizeTrainingStatus(item.trainingStatus),
      diaryDone: Boolean(item.diaryDone)
    };
  }
  return result;
}

function migrateLegacyText(value, oldDefaults, newDefault) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || oldDefaults.includes(text)) return newDefault;
  return text;
}

function normalizeTrainingStatus(value) {
  return ["力量训练", "激活", "恢复", "未训练"].includes(value) ? value : "未训练";
}

function normalizeAcceptanceStatus(value) {
  return ["待验收", "已通过"].includes(value) ? value : "待验收";
}

function getWeekKey(isoDate) {
  const date = parseLocalDate(isoDate);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return toLocalISODate(date);
}

function parseLocalDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toLocalISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return `${year}.${month}.${day}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}
