import { parseBackup, makeBackup } from "./state.js";

const exportBackupButton = document.querySelector("#export-backup");
const importBackupButton = document.querySelector("#import-backup");
const recoveryButton = document.querySelector("#export-recovery");
const backupFile = document.querySelector("#backup-file");
const toast = document.querySelector("#toast");
let toastTimer = null;

function announce(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("visible");
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2600);
}

function downloadBackup(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportBackup() {
  // A rescue export must not depend on localStorage being writable/readable.
  const state = window.checklistStorage.snapshot();
  downloadBackup(makeBackup(state), `mantou-checklist-backup-${state.date || "current"}.json`);
  announce("当前填写的备份已下载；请妥善保存");
}

async function importBackup(file) {
  let validated;
  try {
    if (file.size > 1_000_000) throw new Error("备份文件过大");
    validated = parseBackup(JSON.parse(await file.text()));
  } catch (error) {
    announce(`备份文件无效：${error.message}`);
    backupFile.value = "";
    return;
  }
  try {
    if (!window.confirm("导入会覆盖当前清单，并先保留一份导入前备份。仅恢复本周日志，累计日记与阶段设置会保留。是否继续？")) return;
    await window.checklistStorage.restore(validated);
    announce("备份恢复成功；可下载导入前备份");
  } catch (error) {
    console.warn("Backup import failed", error);
    announce(error.message || "恢复未完成，当前清单未改变");
  } finally {
    backupFile.value = "";
  }
}

exportBackupButton.addEventListener("click", exportBackup);
recoveryButton.addEventListener("click", () => {
  const recovery = window.checklistStorage.recovery();
  if (!recovery) {
    announce("暂无可下载的导入前备份");
    return;
  }
  downloadBackup(recovery, `mantou-checklist-before-import-${recovery.state?.date || "previous"}.json`);
  announce("导入前备份已下载");
});
importBackupButton.addEventListener("click", () => backupFile.click());
backupFile.addEventListener("change", () => {
  const [file] = backupFile.files;
  if (file) importBackup(file);
});
