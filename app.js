const api = window.poe2Market;

const form = document.querySelector("#watchForm");
const nameInput = document.querySelector("#watchName");
const urlInput = document.querySelector("#watchUrl");
const intervalInput = document.querySelector("#watchInterval");
const quantityInput = document.querySelector("#watchQuantity");
const travelDelayInput = document.querySelector("#watchTravelDelay");
const hotkeyInput = document.querySelector("#watchHotkey");
const travelDelayLabel = document.querySelector("#watchTravelDelayLabel");
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
const licenseForm = document.querySelector("#licenseForm");
const licenseCode = document.querySelector("#licenseCode");
const licenseStatus = document.querySelector("#licenseStatus");
const licenseQuota = document.querySelector("#licenseQuota");
const licenseMessage = document.querySelector("#licenseMessage");
const refreshLicense = document.querySelector("#refreshLicense");
const clearLicense = document.querySelector("#clearLicense");

let state = {
  watches: [],
  events: [],
  license: null,
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

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function formatStatus(watch) {
  if (watch.lastError) return "异常";
  if ((watch.purchasedQuantity || 0) >= (watch.targetQuantity || 1)) return "已完成";
  if (!watch.enabled) return "已暂停";
  if (watch.lastResultCount > 0) return "有结果";
  if (watch.lastCheckedAt) return "无结果";
  return "待检查";
}

function normalizeHotkey(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^F([1-9]|1[0-2])$/.test(normalized) ? normalized : "F8";
}

function updateTravelDelayLabel() {
  const hotkey = normalizeHotkey(hotkeyInput.value);
  travelDelayLabel.textContent = `按${hotkey}直传下个卖家仓库，或按下列间隔传送（秒）`;
}

function setState(nextState) {
  state = nextState;
  runState.textContent = state.isRunning ? "监控中" : "已停止";
  watchCount.textContent = state.watches.length;
  document.body.classList.toggle("is-running", state.isRunning);
  renderLicense();
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

function renderLicense() {
  const license = state.license;
  if (!license) return;

  const active = license.status === "active";
  licenseStatus.textContent = active ? "月卡有效" : "免费版";
  licenseStatus.dataset.status = active ? "active" : license.status;
  licenseQuota.textContent = active ? "不限次数" : `${license.remainingFreeTravels} 次`;
  licenseMessage.textContent = active && license.expiresAt
    ? `有效期至 ${formatDate(license.expiresAt)}。`
    : license.message;
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
    node.querySelector(".watch-badge").textContent = formatStatus(watch);
    node.querySelector(".watch-badge").dataset.status = formatStatus(watch);
    node.querySelector(".watch-progress").innerHTML =
      `购买进度 <strong>${watch.purchasedQuantity || 0}/${watch.targetQuantity || 1}</strong>`;
    node.querySelector(".watch-meta").textContent =
      `搜索 ${watch.intervalSeconds}s · 传送间隔 ${watch.travelDelaySeconds || 30}s · 快捷键 ${watch.travelHotkey || "F8"} · 最近检查 ${formatTime(watch.lastCheckedAt)} · 结果 ${watch.lastResultCount ?? 0}`;
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
    targetQuantity: Number(quantityInput.value) || 1,
    travelDelaySeconds: Number(travelDelayInput.value) || 30,
    travelHotkey: normalizeHotkey(hotkeyInput.value),
    selector: selectorInput.value.trim(),
  });

  form.reset();
  intervalInput.value = "60";
  quantityInput.value = "1";
  travelDelayInput.value = "30";
  hotkeyInput.value = "F8";
  updateTravelDelayLabel();
  selectorInput.value = ".resultset .row[data-id], .resultset [data-id]";
  await refreshState();
});

hotkeyInput.addEventListener("keydown", (event) => {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
    hotkeyInput.setCustomValidity("快捷键只支持单个 F1-F12。");
    hotkeyInput.reportValidity();
    return;
  }

  if (/^F([1-9]|1[0-2])$/.test(event.key.toUpperCase())) {
    hotkeyInput.value = event.key.toUpperCase();
    hotkeyInput.setCustomValidity("");
    updateTravelDelayLabel();
    return;
  }

  hotkeyInput.setCustomValidity("快捷键只支持单个 F1-F12。");
  hotkeyInput.reportValidity();
});

hotkeyInput.addEventListener("input", updateTravelDelayLabel);

hotkeyInput.addEventListener("blur", () => {
  hotkeyInput.value = normalizeHotkey(hotkeyInput.value);
  hotkeyInput.setCustomValidity("");
  updateTravelDelayLabel();
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

licenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  licenseMessage.textContent = "正在校验激活码...";
  const license = await api.activateLicense(licenseCode.value);
  setState({ ...state, license });
  if (license.status === "active") licenseCode.value = "";
});

refreshLicense.addEventListener("click", async () => {
  licenseMessage.textContent = "正在刷新授权...";
  const license = await api.refreshLicense();
  setState({ ...state, license });
});

clearLicense.addEventListener("click", async () => {
  const license = await api.clearLicense();
  setState({ ...state, license });
});

api.onStateChanged((nextState) => setState(nextState));
api.onUpdateChanged((nextState) => setUpdateState(nextState));
api.onTriggered(() => refreshState());

refreshState();
api.getUpdateStatus().then(setUpdateState);
updateTravelDelayLabel();
