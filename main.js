const { app, BrowserWindow, ipcMain, Notification, shell, globalShortcut } = require("electron");
const { autoUpdater } = require("electron-updater");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_SELECTOR = ".resultset .row[data-id], .resultset [data-id]";
const DEFAULT_TARGET_QUANTITY = 1;
const MAX_TARGET_QUANTITY = 999;
const DEFAULT_TRAVEL_DELAY_SECONDS = 30;
const DEFAULT_TRAVEL_HOTKEY = "F8";
const LOGIN_URL = "https://www.pathofexile.com/trade2";
const FREE_TRAVEL_LIMIT = 1;
const LICENSE_OFFLINE_CACHE_MS = 24 * 60 * 60 * 1000;
const LICENSE_SERVER_URL = process.env.POE2_LICENSE_SERVER_URL
  || "https://poe2-license-d0gfpfta2f4454ec5.service.tcloudbase.com/api/license/verify";

let mainWindow;
let storePath;
let timers = new Map();
let activeTravelSessions = new Map();
let registeredTravelHotkeys = new Set();
let updateState = {
  status: "idle",
  message: `当前版本 ${app.getVersion()}`,
  progress: null,
  canDownload: false,
  canInstall: false,
};
let isInstallingUpdate = false;
let store = {
  watches: [],
  events: [],
  license: null,
  isRunning: false,
};

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function clampInteger(value, { min, max, fallback }) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeHotkey(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return /^F([1-9]|1[0-2])$/.test(normalized) ? normalized : DEFAULT_TRAVEL_HOTKEY;
}

function defaultLicense() {
  return {
    activationCode: "",
    deviceId: "",
    status: "free",
    plan: "free",
    expiresAt: null,
    freeTravelUsed: 0,
    lastCheckedAt: null,
    offlineValidUntil: null,
    message: "免费版剩余 1 次自动传送。",
  };
}

function sanitizeLicense(input = {}) {
  return {
    ...defaultLicense(),
    activationCode: String(input.activationCode || "").trim(),
    deviceId: String(input.deviceId || ""),
    status: String(input.status || "free"),
    plan: String(input.plan || "free"),
    expiresAt: input.expiresAt || null,
    freeTravelUsed: Math.max(0, Number(input.freeTravelUsed) || 0),
    lastCheckedAt: input.lastCheckedAt || null,
    offlineValidUntil: input.offlineValidUntil || null,
    message: String(input.message || ""),
  };
}

function sanitizeWatch(input) {
  const url = new URL(input.url);
  const intervalSeconds = Math.max(30, Number(input.intervalSeconds) || 60);
  const targetQuantity = clampInteger(input.targetQuantity, {
    min: 1,
    max: MAX_TARGET_QUANTITY,
    fallback: DEFAULT_TARGET_QUANTITY,
  });
  const purchasedQuantity = clampInteger(input.purchasedQuantity, {
    min: 0,
    max: targetQuantity,
    fallback: 0,
  });
  const travelDelaySeconds = clampInteger(input.travelDelaySeconds, {
    min: 1,
    max: 3600,
    fallback: DEFAULT_TRAVEL_DELAY_SECONDS,
  });

  return {
    id: input.id || makeId(),
    name: String(input.name || url.hostname).trim().slice(0, 40),
    url: url.toString(),
    intervalSeconds,
    targetQuantity,
    purchasedQuantity,
    travelDelaySeconds,
    travelHotkey: normalizeHotkey(input.travelHotkey),
    selector: String(input.selector || DEFAULT_SELECTOR).trim(),
    enabled: input.enabled ?? true,
    lastCheckedAt: input.lastCheckedAt || null,
    lastResultCount: input.lastResultCount || 0,
    lastFingerprint: input.lastFingerprint || "",
    lastError: "",
  };
}

function loadStore() {
  storePath = path.join(app.getPath("userData"), "store.json");
  try {
    const loaded = JSON.parse(fs.readFileSync(storePath, "utf8"));
    store = {
      watches: Array.isArray(loaded.watches) ? loaded.watches.map(sanitizeWatch) : [],
      events: Array.isArray(loaded.events) ? loaded.events.slice(0, 50) : [],
      license: sanitizeLicense(loaded.license),
      isRunning: false,
    };
  } catch {
    store = { watches: [], events: [], license: defaultLicense(), isRunning: false };
  }

  store.license.deviceId = getDeviceId();
}

function saveStore() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function publicState() {
  return {
    watches: store.watches,
    events: store.events,
    license: publicLicenseState(),
    isRunning: store.isRunning,
  };
}

function getDeviceId() {
  const existingId = store.license?.deviceId;
  if (existingId) return existingId;

  const raw = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.userInfo().username,
    app.getPath("userData"),
  ].join("|");

  return crypto.createHash("sha256").update(raw).digest("hex");
}

function isPaidLicenseUsable() {
  if (!store.license || store.license.status !== "active") return false;
  if (!store.license.expiresAt) return false;
  return new Date(store.license.expiresAt).getTime() > Date.now();
}

function isOfflineCacheUsable() {
  if (!isPaidLicenseUsable()) return false;
  if (!store.license.offlineValidUntil) return false;
  return new Date(store.license.offlineValidUntil).getTime() > Date.now();
}

function publicLicenseState() {
  const license = store.license || defaultLicense();
  const remainingFreeTravels = Math.max(0, FREE_TRAVEL_LIMIT - license.freeTravelUsed);
  const active = isPaidLicenseUsable();
  return {
    status: active ? "active" : license.status,
    plan: active ? license.plan : "free",
    expiresAt: active ? license.expiresAt : null,
    remainingFreeTravels,
    deviceId: license.deviceId || getDeviceId(),
    lastCheckedAt: license.lastCheckedAt,
    message: license.message || (active ? "月卡有效，自动传送不限次数。" : `免费版剩余 ${remainingFreeTravels} 次自动传送。`),
  };
}

async function verifyLicenseWithServer(activationCode) {
  if (!LICENSE_SERVER_URL) {
    throw new Error("还未配置授权服务器地址。上线收费前需要接入服务端校验接口。");
  }

  const response = await fetch(LICENSE_SERVER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      activationCode,
      deviceId: getDeviceId(),
      appVersion: app.getVersion(),
      platform: process.platform,
    }),
  });

  if (!response.ok) {
    throw new Error(`授权服务器返回 ${response.status}`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.message || "激活码无效或已绑定其他设备。");
  }

  if (!data.expiresAt || new Date(data.expiresAt).getTime() <= Date.now()) {
    throw new Error("激活码已过期。");
  }

  return data;
}

async function activateLicense(activationCode) {
  const normalizedCode = String(activationCode || "").trim();
  if (!normalizedCode) {
    store.license.message = "请输入激活码。";
    emitState();
    return publicLicenseState();
  }

  try {
    const result = await verifyLicenseWithServer(normalizedCode);
    store.license = sanitizeLicense({
      ...store.license,
      activationCode: normalizedCode,
      deviceId: getDeviceId(),
      status: "active",
      plan: result.plan || "monthly",
      expiresAt: result.expiresAt,
      lastCheckedAt: new Date().toISOString(),
      offlineValidUntil: new Date(Date.now() + LICENSE_OFFLINE_CACHE_MS).toISOString(),
      message: result.message || "月卡已激活，自动传送不限次数。",
    });
  } catch (error) {
    store.license = sanitizeLicense({
      ...store.license,
      activationCode: normalizedCode,
      deviceId: getDeviceId(),
      status: isOfflineCacheUsable() ? "active" : "error",
      lastCheckedAt: new Date().toISOString(),
      message: error.message || String(error),
    });
  }

  emitState();
  return publicLicenseState();
}

async function refreshLicense() {
  if (!store.license?.activationCode) {
    emitState();
    return publicLicenseState();
  }

  return activateLicense(store.license.activationCode);
}

function clearLicense() {
  store.license = {
    ...defaultLicense(),
    deviceId: getDeviceId(),
    freeTravelUsed: store.license?.freeTravelUsed || 0,
  };
  emitState();
  return publicLicenseState();
}

async function authorizeAutoTravel() {
  if (isPaidLicenseUsable()) {
    if (isOfflineCacheUsable()) {
      return { allowed: true, mode: "paid" };
    }

    await refreshLicense();
    if (isPaidLicenseUsable()) {
      return { allowed: true, mode: "paid" };
    }
  }

  if (store.license.freeTravelUsed < FREE_TRAVEL_LIMIT) {
    store.license.freeTravelUsed += 1;
    store.license.message = "已使用免费自动传送机会。";
    return { allowed: true, mode: "free" };
  }

  store.license.message = "免费自动传送次数已用完，请输入月卡激活码。";
  return { allowed: false, mode: "locked" };
}

function emitState() {
  saveStore();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state:changed", publicState());
  }
}

function emitUpdateState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("update:changed", updateState);
  }
}

function setUpdateState(nextState) {
  updateState = { ...updateState, ...nextState };
  emitUpdateState();
}

function refreshTravelHotkeys() {
  if (!app.isReady()) return;

  const wantedHotkeys = new Set(
    store.watches
      .map((watch) => normalizeHotkey(watch.travelHotkey))
      .filter(Boolean),
  );
  wantedHotkeys.add(DEFAULT_TRAVEL_HOTKEY);

  registeredTravelHotkeys.forEach((hotkey) => {
    if (!wantedHotkeys.has(hotkey)) {
      globalShortcut.unregister(hotkey);
      registeredTravelHotkeys.delete(hotkey);
    }
  });

  wantedHotkeys.forEach((hotkey) => {
    if (registeredTravelHotkeys.has(hotkey)) return;
    const registered = globalShortcut.register(hotkey, () => triggerTravelHotkey(hotkey));
    if (registered) registeredTravelHotkeys.add(hotkey);
  });
}

function triggerTravelHotkey(hotkey) {
  const targetSession = Array.from(activeTravelSessions.values())
    .filter((session) => session.waiting && session.hotkey === hotkey)
    .sort((left, right) => left.waitingSince - right.waitingSince)[0];

  if (targetSession) targetSession.resolveWait("hotkey");
}

function cancelTravelSession(id, reason = "cancelled") {
  const session = activeTravelSessions.get(id);
  if (session) session.resolveWait(reason);
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: "POE2 集市提醒器",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.js"),
    },
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));
}

function createBrowserWindow({ show = true, title = "POE2 市集" } = {}) {
  return new BrowserWindow({
    width: 1280,
    height: 860,
    show,
    title,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:poe2-market",
    },
  });
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function clickNextTravelToHideout(win, watch) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (win.isDestroyed()) return false;

    const result = await win.webContents.executeJavaScript(
      `(() => {
        const rowSelector = ${JSON.stringify(watch.selector || DEFAULT_SELECTOR)};
        const isVisible = (node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const findRow = (node) => {
          try {
            const row = node.closest(rowSelector);
            if (row) return row;
          } catch {}
          return node.closest("[data-id]") || node.closest(".row") || node.parentElement || node;
        };
        const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"))
          .filter((node) => /^travel\\s+to\\s+hideout$/i.test((node.textContent || "").replace(/\\s+/g, " ").trim()))
          .filter(isVisible)
          .map((node) => ({ node, row: findRow(node), rect: node.getBoundingClientRect() }))
          .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
        let skippedIgnored = 0;
        let skippedClicked = 0;
        const target = candidates.find((candidate) => {
          const rowText = (candidate.row.textContent || "").replace(/\\s+/g, " ").trim();
          if (/unignore\\s+player/i.test(rowText)) {
            skippedIgnored += 1;
            return false;
          }
          if (/\\b(?:traveling|teleporting)!?/i.test(rowText)) {
            skippedClicked += 1;
            return false;
          }
          return true;
        });
        if (!target) return { clicked: false, skippedIgnored, skippedClicked };
        target.node.scrollIntoView({ block: "center", inline: "center" });
        target.node.click();
        return {
          clicked: true,
          skippedIgnored,
          skippedClicked,
          text: (target.node.textContent || "").trim(),
        };
      })();`,
      true,
    );

    if (result.clicked) return true;
    await wait(500);
  }

  return false;
}

function waitForNextTravelWindow(watch, win) {
  return new Promise((resolve) => {
    const hotkey = normalizeHotkey(watch.travelHotkey);
    const delayMs = watch.travelDelaySeconds * 1000;
    const session = {
      watchId: watch.id,
      hotkey,
      waiting: true,
      waitingSince: Date.now(),
      timeout: null,
      resolveWait: null,
    };

    const closeHandler = () => session.resolveWait("closed");
    session.resolveWait = (reason) => {
      if (!session.waiting) return;
      session.waiting = false;
      clearTimeout(session.timeout);
      if (!win.isDestroyed()) win.off("closed", closeHandler);
      activeTravelSessions.delete(watch.id);
      resolve(reason);
    };

    activeTravelSessions.set(watch.id, session);
    win.once("closed", closeHandler);
    session.timeout = setTimeout(() => session.resolveWait("timer"), delayMs);
  });
}

async function runAutoTravelSequence(win, watch, maxClicks) {
  let clickedCount = 0;

  while (!win.isDestroyed() && findWatch(watch.id) === watch && watch.enabled && clickedCount < maxClicks) {
    const remaining = Math.max(0, watch.targetQuantity - watch.purchasedQuantity);
    if (remaining <= 0) break;

    const clicked = await clickNextTravelToHideout(win, watch);
    if (!clicked) break;

    clickedCount += 1;
    watch.purchasedQuantity = Math.min(watch.targetQuantity, watch.purchasedQuantity + 1);
    watch.lastError = "";

    if (watch.purchasedQuantity >= watch.targetQuantity) {
      watch.enabled = false;
      clearWatchTimer(watch.id);
      emitState();
      break;
    }

    emitState();
    if (clickedCount < maxClicks) {
      await waitForNextTravelWindow(watch, win);
    }
  }

  activeTravelSessions.delete(watch.id);
  return clickedCount;
}

async function inspectSearchPage(watch) {
  const hiddenWindow = createBrowserWindow({ show: false, title: `检查 ${watch.name}` });

  try {
    await hiddenWindow.loadURL(watch.url);
    await new Promise((resolve) => setTimeout(resolve, 4200));

    const result = await hiddenWindow.webContents.executeJavaScript(
      `(() => {
        const selector = ${JSON.stringify(watch.selector || DEFAULT_SELECTOR)};
        const bodyText = document.body.innerText || "";
        const officialCountMatch = bodyText.match(/showing\\s+(\\d+)\\s+results?/i)
          || bodyText.match(/显示\\s*(\\d+)\\s*(?:个)?结果/i);
        const officialCount = officialCountMatch ? Number(officialCountMatch[1]) : null;
        const nodes = Array.from(document.querySelectorAll(selector))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            const text = (node.textContent || "").trim();
            const hasTradeControls = /asking price|listed|travel to hideout|ignore player/i.test(text);
            return rect.width > 0 && rect.height > 0 && text.length > 0 && hasTradeControls;
          });
        const rows = nodes.slice(0, 10).map((node) => (node.textContent || "").replace(/\\s+/g, " ").trim());
        return {
          count: officialCount ?? nodes.length,
          fingerprint: rows.join("|").slice(0, 2000),
          title: document.title,
          needsLogin: /登录|login|sign in/i.test(bodyText)
        };
      })();`,
      true,
    );

    watch.lastCheckedAt = new Date().toISOString();
    watch.lastResultCount = result.count;
    watch.lastError = result.needsLogin ? "页面可能需要重新登录。请点击“打开登录窗口”后再检查。" : "";

    const hasHit = result.count > 0;
    watch.lastFingerprint = result.fingerprint || "";

    if (hasHit) {
      const event = {
        id: makeId(),
        watchId: watch.id,
        name: watch.name,
        url: watch.url,
        resultCount: result.count,
        createdAt: new Date().toISOString(),
      };
      store.events.unshift(event);
      store.events = store.events.slice(0, 50);
      await notifyHit(watch, event);
    }
  } catch (error) {
    watch.lastCheckedAt = new Date().toISOString();
    watch.lastError = error.message || String(error);
  } finally {
    if (!hiddenWindow.isDestroyed()) hiddenWindow.destroy();
  }

  emitState();
}

async function notifyHit(watch, event) {
  const remainingQuantity = Math.max(0, watch.targetQuantity - watch.purchasedQuantity);
  if (remainingQuantity <= 0) {
    watch.enabled = false;
    clearWatchTimer(watch.id);
    emitState();
    return;
  }

  const travelAuth = await authorizeAutoTravel();
  const maxAutoTravelClicks = travelAuth.allowed
    ? Math.min(remainingQuantity, travelAuth.mode === "free" ? 1 : remainingQuantity)
    : 0;

  if (Notification.isSupported()) {
    const notification = new Notification({
      title: `${event.name} 有新结果`,
      body: travelAuth.allowed
        ? `发现 ${event.resultCount} 个结果。正在按顺序传送，目标 ${watch.purchasedQuantity}/${watch.targetQuantity}。`
        : `发现 ${event.resultCount} 个结果。自动传送次数已用完。`,
    });
    notification.on("click", () => openWatch(event.watchId));
    notification.show();
  }

  await openWatch(event.watchId, {
    autoTravelToHideout: travelAuth.allowed,
    maxAutoTravelClicks,
  });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("watch:triggered", { ...event, travelMode: travelAuth.mode });
    mainWindow.show();
  }
}

function scheduleWatch(watch) {
  clearWatchTimer(watch.id);
  if (!store.isRunning || !watch.enabled) return;

  const run = async () => {
    await inspectSearchPage(watch);
    if (store.isRunning && watch.enabled) {
      timers.set(watch.id, setTimeout(run, watch.intervalSeconds * 1000));
    }
  };

  timers.set(watch.id, setTimeout(run, 500));
}

function clearWatchTimer(id) {
  const timer = timers.get(id);
  if (timer) clearTimeout(timer);
  timers.delete(id);
}

function startAll() {
  store.isRunning = true;
  store.watches.forEach(scheduleWatch);
  emitState();
}

function stopAll() {
  store.isRunning = false;
  timers.forEach((timer) => clearTimeout(timer));
  timers.clear();
  Array.from(activeTravelSessions.keys()).forEach((id) => cancelTravelSession(id, "stopped"));
  emitState();
}

function findWatch(id) {
  return store.watches.find((watch) => watch.id === id);
}

async function openWatch(id, { autoTravelToHideout = false, maxAutoTravelClicks = 1 } = {}) {
  const watch = findWatch(id);
  if (!watch) return false;
  const win = createBrowserWindow({ show: true, title: watch.name });
  await win.loadURL(watch.url);
  if (autoTravelToHideout) {
    await runAutoTravelSequence(win, watch, maxAutoTravelClicks);
  }
  return true;
}

function registerIpc() {
  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle("license:get", () => publicLicenseState());
  ipcMain.handle("license:activate", (_event, activationCode) => activateLicense(activationCode));
  ipcMain.handle("license:refresh", () => refreshLicense());
  ipcMain.handle("license:clear", () => clearLicense());
  ipcMain.handle("update:get-status", () => updateState);

  ipcMain.handle("watch:add", (_event, input) => {
    store.watches.unshift(sanitizeWatch(input));
    refreshTravelHotkeys();
    emitState();
    return publicState();
  });

  ipcMain.handle("watch:remove", (_event, id) => {
    clearWatchTimer(id);
    cancelTravelSession(id, "removed");
    store.watches = store.watches.filter((watch) => watch.id !== id);
    store.events = store.events.filter((event) => event.watchId !== id);
    refreshTravelHotkeys();
    emitState();
    return publicState();
  });

  ipcMain.handle("watch:toggle", (_event, id) => {
    const watch = findWatch(id);
    if (!watch) return publicState();
    watch.enabled = !watch.enabled;
    if (watch.enabled && watch.purchasedQuantity >= watch.targetQuantity) {
      watch.purchasedQuantity = 0;
    }
    if (watch.enabled) scheduleWatch(watch);
    else clearWatchTimer(id);
    emitState();
    return publicState();
  });

  ipcMain.handle("watch:check", async (_event, id) => {
    const watch = findWatch(id);
    if (watch) await inspectSearchPage(watch);
    return publicState();
  });

  ipcMain.handle("watch:open", (_event, id) => openWatch(id));
  ipcMain.handle("watch:start-all", () => startAll());
  ipcMain.handle("watch:stop-all", () => stopAll());

  ipcMain.handle("events:clear", () => {
    store.events = [];
    emitState();
    return publicState();
  });

  ipcMain.handle("browser:login", async () => {
    const win = createBrowserWindow({ show: true, title: "POE2 市集登录" });
    try {
      await win.loadURL(LOGIN_URL);
    } catch {
      await shell.openExternal(LOGIN_URL);
    }
    return true;
  });

  ipcMain.handle("update:check", async () => {
    if (!app.isPackaged) {
      setUpdateState({
        status: "dev",
        message: "开发模式不能自动更新，打包安装后可用。",
        progress: null,
        canDownload: false,
        canInstall: false,
      });
      return updateState;
    }

    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      setUpdateState({
        status: "error",
        message: `检查更新失败：${error.message || String(error)}`,
        progress: null,
        canDownload: false,
        canInstall: false,
      });
    }
    return updateState;
  });

  ipcMain.handle("update:download", async () => {
    if (!updateState.canDownload) return updateState;
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      setUpdateState({
        status: "error",
        message: `下载更新失败：${error.message || String(error)}`,
        progress: null,
        canDownload: true,
        canInstall: false,
      });
    }
    return updateState;
  });

  ipcMain.handle("update:install", () => {
    if (!updateState.canInstall) return false;
    isInstallingUpdate = true;
    stopAll();
    setUpdateState({
      status: "installing",
      message: "正在关闭软件并安装更新...",
      progress: 100,
      canDownload: false,
      canInstall: false,
    });

    setImmediate(() => {
      autoUpdater.quitAndInstall(true, true);
    });
    return true;
  });
}

function registerUpdaterEvents() {
  autoUpdater.on("checking-for-update", () => {
    setUpdateState({
      status: "checking",
      message: "正在检查新版本...",
      progress: null,
      canDownload: false,
      canInstall: false,
    });
  });

  autoUpdater.on("update-available", (info) => {
    setUpdateState({
      status: "available",
      message: `发现新版本 ${info.version}，可以下载。`,
      progress: null,
      canDownload: true,
      canInstall: false,
    });
  });

  autoUpdater.on("update-not-available", () => {
    setUpdateState({
      status: "current",
      message: `已经是最新版本 ${app.getVersion()}。`,
      progress: null,
      canDownload: false,
      canInstall: false,
    });
  });

  autoUpdater.on("download-progress", (progress) => {
    setUpdateState({
      status: "downloading",
      message: `正在下载更新 ${Math.round(progress.percent)}%`,
      progress: Math.round(progress.percent),
      canDownload: false,
      canInstall: false,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setUpdateState({
      status: "downloaded",
      message: `新版本 ${info.version} 已下载，重启后安装。`,
      progress: 100,
      canDownload: false,
      canInstall: true,
    });
  });

  autoUpdater.on("error", (error) => {
    setUpdateState({
      status: "error",
      message: `更新出错：${error.message || String(error)}`,
      progress: null,
      canDownload: false,
      canInstall: false,
    });
  });
}

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("local.poe2.market.alert");
  }

  loadStore();
  registerIpc();
  registerUpdaterEvents();
  refreshTravelHotkeys();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", () => {
  stopAll();
  registeredTravelHotkeys.forEach((hotkey) => globalShortcut.unregister(hotkey));
  registeredTravelHotkeys.clear();
});

app.on("window-all-closed", () => {
  if (isInstallingUpdate) return;
  if (process.platform !== "darwin") app.quit();
});
