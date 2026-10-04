const shell = document.querySelector("#mobile-editor");
const tabs = [...document.querySelectorAll("[data-editor-view]")];
const connectionStatus = document.querySelector("#connection-status");
let offlineReady = Boolean(navigator.serviceWorker?.controller);

function selectView(tab, { focus = false } = {}) {
  shell.dataset.view = tab.dataset.editorView;
  for (const item of tabs) {
    const selected = item === tab;
    item.classList.toggle("active", selected);
    item.setAttribute("aria-selected", String(selected));
    item.tabIndex = selected ? 0 : -1;
  }
  if (focus) tab.focus();
  window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

for (const tab of tabs) {
  tab.addEventListener("click", () => selectView(tab));
  tab.addEventListener("keydown", (event) => {
    const index = tabs.indexOf(tab);
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length
      : event.key === "ArrowLeft" ? (index + tabs.length - 1) % tabs.length
      : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    selectView(tabs[next], { focus: true });
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

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready.then(() => {
    offlineReady = true;
    updateConnectionStatus();
  });
}

