const shell = document.querySelector("#mobile-editor");
const tabs = [...document.querySelectorAll("[data-editor-view]")];
const connectionStatus = document.querySelector("#connection-status");
const exportBackupButton = document.querySelector("#export-backup");
const importBackupButton = document.querySelector("#import-backup");
const backupFile = document.querySelector("#backup-file");
const toast = document.querySelector("#toast");
let toastTimer = null;
let offlineReady = Boolean(navigator.serviceWorker?.controller);

for (const tab of tabs) {
  tab.addEventListener("click", () => {
    const view = tab.dataset.editorView;
    shell.dataset.view = view;

    for (const item of tabs) {
      const selected = item === tab;
      item.classList.toggle("active", selected);
      item.setAttribute("aria-selected", String(selected));
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  });
}

function updateConnectionStatus() {
  const online = navigator.onLine;
  connectionStatus.classList.toggle("offline", !online);
  connectionStatus.innerHTML = online
    ? offlineReady
      ? '<span aria-hidden="true"></span><strong>在线</strong> · 已可离线使用'
      : '<span aria-hidden="true"></span><strong>在线</strong> · 正在准备离线功能'
    : '<span aria-hidden="true"></span><strong>离线运行</strong> · 填写和下载仍可使用';
}

function announce(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function exportBackup() {
  const state = window.checklistStorage.save();
  const payload = {
    format: "mantou-personal-investment-checklist",
    version: 1,
    exportedAt: new Date().toISOString(),
    state
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mantou-checklist-backup-${state.date || "current"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  announce("本地备份已下载");
}

async function importBackup(file) {
  try {
    const payload = JSON.parse(await file.text());
    const state = payload?.state ?? payload;
    if (!isValidBackupState(state)) throw new Error("invalid backup");
    if (!window.confirm("导入会覆盖当前手机中的清单数据，是否继续？")) return;
    window.checklistStorage.restore(state);
    announce("备份恢复成功");
  } catch (error) {
    console.warn("Backup import failed", error);
    announce("备份文件无效，请选择由本编辑器导出的 JSON 文件");
  } finally {
    backupFile.value = "";
  }
}

function isValidBackupState(state) {
  return Boolean(
    state &&
    typeof state === "object" &&
    typeof state.date === "string" &&
    Number.isFinite(Number(state.diaryDay)) &&
    Number.isFinite(Number(state.gymCount))
  );
}

exportBackupButton.addEventListener("click", exportBackup);
importBackupButton.addEventListener("click", () => backupFile.click());
backupFile.addEventListener("change", () => {
  const [file] = backupFile.files;
  if (file) importBackup(file);
});
window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready.then(() => {
    offlineReady = true;
    updateConnectionStatus();
  });
}
