const api = window.poe2Market;

const form = document.querySelector("#watchForm");
const nameInput = document.querySelector("#watchName");
const urlInput = document.querySelector("#watchUrl");
const intervalInput = document.querySelector("#watchInterval");
const selectorInput = document.querySelector("#watchSelector");
const watchList = document.querySelector("#watchList");
const eventLog = document.querySelector("#eventLog");
const watchTemplate = document.querySelector("#watchTemplate");
const logTemplate = document.querySelector("#logTemplate");
const startAll = document.querySelector("#startAll");
const stopAll = document.querySelector("#stopAll");
const openLogin = document.querySelector("#openLogin");
const checkUpdate = document.querySelector("#checkUpdate");
const installUpdate = document.querySelector("#installUpdate");
const updateStatus = document.querySelector("#updateStatus");
const refreshList = document.querySelector("#refreshList");
const clearLog = document.querySelector("#clearLog");
const runState = document.querySelector("#runState");
const watchCount = document.querySelector("#watchCount");

let state = {
  watches: [],
  events: [],
  isRunning: false,
};

let updateState = {
  status: "idle",
  message: "当前版本检查中...",
  progress: null,
  canDownload: false,
  canInstall: false,
};

function formatTime(value) {
  if (!value) return "从未";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatStatus(watch) {
  if (watch.lastError) return "异常";
  if (watch.lastResultCount > 0) return "有结果";
  if (watch.lastCheckedAt) return "无结果";
  return "待检查";
}

function setState(nextState) {
  state = nextState;
  runState.textContent = state.isRunning ? "监控中" : "已停止";
  watchCount.textContent = state.watches.length;
  document.body.classList.toggle("is-running", state.isRunning);
  renderWatches();
  renderEvents();
}

function setUpdateState(nextState) {
  updateState = nextState;
  updateStatus.textContent = updateState.message;
  installUpdate.hidden = !updateState.canInstall;

  if (updateState.canDownload) {
    checkUpdate.textContent = "下载更新";
    checkUpdate.disabled = false;
  } else if (updateState.status === "checking" || updateState.status === "downloading") {
    checkUpdate.textContent = updateState.status === "checking" ? "正在检查..." : "正在下载...";
    checkUpdate.disabled = true;
  } else {
    checkUpdate.textContent = "检查更新";
    checkUpdate.disabled = false;
  }
}

function renderWatches() {
  watchList.innerHTML = "";

  if (!state.watches.length) {
    watchList.innerHTML = '<div class="empty-state">还没有搜索。把市集搜索 URL 粘进来，就能开始监控。</div>';
    return;
  }

  state.watches.forEach((watch) => {
    const node = watchTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.id = watch.id;
    node.querySelector("h3").textContent = watch.name;
    node.querySelector(".watch-url").textContent = watch.url;
    node.querySelector(".watch-badge").textContent = formatStatus(watch);
    node.querySelector(".watch-badge").dataset.status = formatStatus(watch);
    node.querySelector(".watch-meta").textContent =
      `${watch.intervalSeconds}s 一次 · 最近检查 ${formatTime(watch.lastCheckedAt)} · 结果 ${watch.lastResultCount ?? 0}`;
    node.querySelector('[data-action="toggle"]').textContent = watch.enabled ? "暂停" : "启用";

    if (watch.lastError) {
      const error = document.createElement("p");
      error.className = "watch-error";
      error.textContent = watch.lastError;
      node.querySelector(".watch-meta").after(error);
    }

    watchList.append(node);
  });
}

function renderEvents() {
  eventLog.innerHTML = "";

  if (!state.events.length) {
    eventLog.innerHTML = '<div class="empty-state">触发后会在这里显示来源、时间和结果数量。</div>';
    return;
  }

  state.events.slice(0, 20).forEach((event) => {
    const node = logTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector("strong").textContent = event.name;
    node.querySelector("span").textContent = `${formatTime(event.createdAt)} · ${event.resultCount} 个结果`;
    node.querySelector("button").addEventListener("click", () => api.openWatch(event.watchId));
    eventLog.append(node);
  });
}

async function refreshState() {
  setState(await api.getState());
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  await api.addWatch({
    name: nameInput.value.trim(),
    url: urlInput.value.trim(),
    intervalSeconds: Number(intervalInput.value) || 60,
    selector: selectorInput.value.trim(),
  });

  form.reset();
  intervalInput.value = "60";
  selectorInput.value = ".resultset .row[data-id], .resultset [data-id]";
  await refreshState();
});

watchList.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  const card = event.target.closest(".watch-card");
  if (!button || !card) return;

  const id = card.dataset.id;
  const action = button.dataset.action;
  if (action === "check") await api.checkWatch(id);
  if (action === "open") await api.openWatch(id);
  if (action === "toggle") await api.toggleWatch(id);
  if (action === "remove") await api.removeWatch(id);
  await refreshState();
});

startAll.addEventListener("click", async () => {
  await api.startAll();
  await refreshState();
});

stopAll.addEventListener("click", async () => {
  await api.stopAll();
  await refreshState();
});

openLogin.addEventListener("click", () => api.openLogin());
refreshList.addEventListener("click", refreshState);

checkUpdate.addEventListener("click", async () => {
  if (updateState.canDownload) {
    setUpdateState(await api.downloadUpdate());
    return;
  }
  setUpdateState(await api.checkForUpdates());
});

installUpdate.addEventListener("click", () => api.installUpdate());

clearLog.addEventListener("click", async () => {
  await api.clearEvents();
  await refreshState();
});

api.onStateChanged((nextState) => setState(nextState));
api.onUpdateChanged((nextState) => setUpdateState(nextState));
api.onTriggered(() => refreshState());

refreshState();
api.getUpdateStatus().then(setUpdateState);
