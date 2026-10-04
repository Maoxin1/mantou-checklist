const shell = document.querySelector("#mobile-editor");
const tabs = [...document.querySelectorAll("[data-editor-view]")];
const connectionStatus = document.querySelector("#connection-status");
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

window.addEventListener("online", updateConnectionStatus);
window.addEventListener("offline", updateConnectionStatus);
updateConnectionStatus();

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.ready.then(() => {
    offlineReady = true;
    updateConnectionStatus();
  });
}

