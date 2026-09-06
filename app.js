const STORAGE_KEY = "personal-investment-checklist:v1";
const DEADLINE = "2026-09-19";

const fallbackConfig = {
  diaryDay: 1291,
  investmentPhase: "主动投资系统建设中",
  readingPhase: "Beyond Feelings · W1",
  englishStatus: "今日未开始",
  nextResult: "批判性判断框架 v0.1",
  nextResultDate: "待验收",
  nextResult2: "",
  nextResultDate2: "待验收",
  nextResult3: "",
  nextResultDate3: "待验收",
  motto: "把时间转化为能力、资本与自主权。",
  beforeDeadline: {
    bodyPhase: "减脂收官",
    bodyMeta: "9.19验收"
  },
  afterDeadline: {
    bodyPhase: "精干强健计划",
    bodyMeta: "持续期"
  }
};

const config = await loadConfig();

const elements = {
  form: document.querySelector("#checklist-form"),
  date: document.querySelector("#date"),
  bodyPhase: document.querySelector("#body-phase"),
  bodyMeta: document.querySelector("#body-meta"),
  investmentPhase: document.querySelector("#investment-phase"),
  readingPhase: document.querySelector("#reading-phase"),
  diaryDone: document.querySelector("#diary-done"),
  diaryDay: document.querySelector("#diary-day"),
  englishStatus: document.querySelector("#english-status"),
  gymCount: document.querySelector("#gym-count"),
  nextResult: document.querySelector("#next-result"),
  nextResultDate: document.querySelector("#next-result-date"),
  nextResult2: document.querySelector("#next-result-2"),
  nextResultDate2: document.querySelector("#next-result-date-2"),
  nextResult3: document.querySelector("#next-result-3"),
  nextResultDate3: document.querySelector("#next-result-date-3"),
  motto: document.querySelector("#motto"),
  gymMinus: document.querySelector("#gym-minus"),
  gymPlus: document.querySelector("#gym-plus"),
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
  fillForm(state);
  lastDiaryDone = state.diaryDone;
  activeDiaryDate = state.date;
  render(true);
  bindEvents();
  registerServiceWorker();
}

function buildInitialState(saved, today) {
  const currentWeek = getWeekKey(today);
  const diaryDay = Number(saved?.diaryDay || config.diaryDay);

  const phase = getPhaseDefaults(today);

  return {
    date: today,
    bodyPhase: saved?.date === today ? saved.bodyPhase : phase.bodyPhase,
    bodyMeta: saved?.date === today ? saved.bodyMeta : phase.bodyMeta,
    investmentPhase: saved?.investmentPhase || config.investmentPhase,
    readingPhase: saved?.readingPhase || config.readingPhase,
    diaryDone: saved?.date === today ? Boolean(saved.diaryDone) : false,
    diaryDay,
    englishStatus: saved?.date === today
      ? normalizeReadingStatus(saved?.englishStatus)
      : normalizeReadingStatus(config.englishStatus),
    gymCount: saved?.weekKey === currentWeek ? clamp(saved.gymCount, 0, 4) : 0,
    weekKey: currentWeek,
    nextResult: saved?.nextResult || config.nextResult,
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
    if (elements.date.value !== activeDiaryDate) {
      elements.diaryDone.checked = false;
      lastDiaryDone = false;
      elements.englishStatus.value = normalizeReadingStatus(config.englishStatus);
      activeDiaryDate = elements.date.value;
    }
    applyPhaseDefaults();
    ensureCurrentWeek();
    render();
    saveState();
  });

  elements.gymMinus.addEventListener("click", () => adjustGym(-1));
  elements.gymPlus.addEventListener("click", () => adjustGym(1));
  elements.diaryDone.addEventListener("change", updateDiaryTotal);
  elements.phaseDefaults.addEventListener("click", () => {
    applyPhaseDefaults();
    render();
    saveState();
    showToast("已按日期恢复阶段默认值");
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
  elements.diaryDone.checked = state.diaryDone;
  elements.diaryDay.value = state.diaryDay;
  elements.englishStatus.value = state.englishStatus;
  elements.gymCount.value = state.gymCount;
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
  return {
    date: elements.date.value || toLocalISODate(new Date()),
    bodyPhase: elements.bodyPhase.value.trim(),
    bodyMeta: elements.bodyMeta.value.trim(),
    investmentPhase: elements.investmentPhase.value.trim(),
    readingPhase: elements.readingPhase.value.trim(),
    diaryDone: elements.diaryDone.checked,
    diaryDay: Math.max(0, Number(elements.diaryDay.value) || 0),
    englishStatus: elements.englishStatus.value,
    gymCount: clamp(elements.gymCount.value, 0, 4),
    weekKey: getWeekKey(elements.date.value || toLocalISODate(new Date())),
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
  const phase = getPhaseDefaults(elements.date.value);
  elements.bodyPhase.value = phase.bodyPhase;
  elements.bodyMeta.value = phase.bodyMeta;
}

function getPhaseDefaults(date) {
  return date <= DEADLINE ? config.beforeDeadline : config.afterDeadline;
}

function ensureCurrentWeek() {
  const date = elements.date.value || toLocalISODate(new Date());
  const saved = loadState();
  if (saved?.weekKey !== getWeekKey(date)) elements.gymCount.value = 0;
}

function adjustGym(delta) {
  elements.gymCount.value = clamp(Number(elements.gymCount.value) + delta, 0, 4);
  render();
  saveState();
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
    gold: "#b28a55",
    white: "#ffffff"
  };
  const statusText = state.diaryDone ? "✓ 今日完成" : "— 今日待完成";

  context.fillStyle = theme.paper;
  context.fillRect(0, 0, 1080, 1536);
  context.fillStyle = theme.primary;
  context.fillRect(0, 0, 1080, 270);

  drawFitText(context, "mantou", 72, 68, 240, 30, 900, fontFamily, theme.white);
  drawFitText(context, formatDisplayDate(state.date), 1008, 68, 320, 30, 800, fontFamily, "#dbe8df", "right");
  drawFitText(context, "个人定投", 72, 166, 640, 72, 900, fontFamily, theme.white);
  drawFitText(context, state.motto || config.motto, 72, 225, 900, 28, 700, fontFamily, "#dbe8df");

  drawArchiveCard(context, 54, 314, 972, 300, theme.white, theme.primary);
  drawFitText(context, "阶段推进", 94, 376, 300, 29, 900, fontFamily, theme.primary);
  drawArchiveRow(context, 94, 460, "身体", `${state.bodyPhase || "未填写"}${state.bodyMeta ? ` · ${state.bodyMeta}` : ""}`, theme, fontFamily);
  drawArchiveRow(context, 94, 528, "投资", state.investmentPhase || "未填写", theme, fontFamily);
  drawArchiveRow(context, 94, 596, "认知训练", state.readingPhase || "未填写", theme, fontFamily);

  drawArchiveCard(context, 54, 650, 972, 336, theme.white, theme.primary);
  drawFitText(context, "今日积累", 94, 712, 300, 29, 900, fontFamily, theme.primary);
  drawArchiveRow(context, 94, 796, "日记", `${statusText}  ·  累计有效 ${state.diaryDay} 天`, theme, fontFamily);
  drawArchiveRow(context, 94, 876, "认知训练", state.englishStatus, theme, fontFamily);
  drawArchiveRow(context, 94, 956, "健身", `${state.gymCount}/4 天`, theme, fontFamily);

  const deliverables = [
    { value: state.nextResult, status: state.nextResultDate },
    { value: state.nextResult2, status: state.nextResultDate2 },
    { value: state.nextResult3, status: state.nextResultDate3 }
  ].filter((item) => item.value.trim());

  drawArchiveCard(context, 54, 1034, 972, 100 + deliverables.length * 50, theme.white, theme.gold);
  drawFitText(context, "本周交付物", 94, 1088, 300, 28, 900, fontFamily, theme.gold);
  deliverables.forEach((item, index) => {
    drawResultRow(
      context,
      94,
      1144 + index * 54,
      String(index + 1).padStart(2, "0"),
      item.value,
      item.status,
      theme,
      fontFamily
    );
  });

  context.fillStyle = theme.line;
  context.fillRect(72, 1390, 936, 2);
  drawFitText(context, "长期积累不是重复，而是持续产生可验证的变化。", 72, 1450, 850, 27, 700, fontFamily, theme.muted);
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
  drawFitText(context, value, x + 58, baseline, 630, 30, 800, fontFamily, theme.ink);
  drawFitText(
    context,
    status,
    x + 884,
    baseline,
    170,
    24,
    800,
    fontFamily,
    status === "已通过" ? theme.primary : theme.muted,
    "right"
  );
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

function getWeekKey(isoDate) {
  const date = parseLocalDate(isoDate);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return toLocalISODate(date);
}

function daysBetween(from, to) {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  return Math.round((end - start) / 86400000);
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

function normalizeReadingStatus(value) {
  return ["今日完成", "今日未开始", "休息日"].includes(value) ? value : "今日未开始";
}

function normalizeAcceptanceStatus(value) {
  return ["待验收", "已通过"].includes(value) ? value : "待验收";
}
