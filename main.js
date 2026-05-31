const { app, BrowserWindow, ipcMain, Notification, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const fs = require("fs");
const path = require("path");

const DEFAULT_SELECTOR = ".resultset .row[data-id], .resultset [data-id]";
const LOGIN_URL = "https://www.pathofexile.com/trade2";

let mainWindow;
let storePath;
let timers = new Map();
let updateState = {
  status: "idle",
  message: `当前版本 ${app.getVersion()}`,
  progress: null,
  canDownload: false,
  canInstall: false,
};
let store = {
  watches: [],
  events: [],
  isRunning: false,
};

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeWatch(input) {
  const url = new URL(input.url);
  const intervalSeconds = Math.max(30, Number(input.intervalSeconds) || 60);
  return {
    id: input.id || makeId(),
    name: String(input.name || url.hostname).trim().slice(0, 40),
    url: url.toString(),
    intervalSeconds,
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
      isRunning: false,
    };
  } catch {
    store = { watches: [], events: [], isRunning: false };
  }
}

function saveStore() {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, JSON.stringify(store, null, 2));
}

function publicState() {
  return {
    watches: store.watches,
    events: store.events,
    isRunning: store.isRunning,
  };
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

async function clickFirstTravelToHideout(win) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (win.isDestroyed()) return false;

    const result = await win.webContents.executeJavaScript(
      `(() => {
        const isVisible = (node) => {
          const rect = node.getBoundingClientRect();
          const style = window.getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        };
        const candidates = Array.from(document.querySelectorAll("button, a, [role='button']"))
          .filter((node) => /travel\\s+to\\s+hideout/i.test((node.textContent || "").trim()))
          .filter(isVisible);
        const target = candidates[0];
        if (!target) return { clicked: false };
        target.scrollIntoView({ block: "center", inline: "center" });
        target.click();
        return { clicked: true, text: (target.textContent || "").trim() };
      })();`,
      true,
    );

    if (result.clicked) return true;
    await wait(500);
  }

  return false;
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
      await notifyHit(event);
    }
  } catch (error) {
    watch.lastCheckedAt = new Date().toISOString();
    watch.lastError = error.message || String(error);
  } finally {
    if (!hiddenWindow.isDestroyed()) hiddenWindow.destroy();
  }

  emitState();
}

async function notifyHit(event) {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: `${event.name} 有新结果`,
      body: `发现 ${event.resultCount} 个结果。正在尝试进入第一个结果的藏身处。`,
    });
    notification.on("click", () => openWatch(event.watchId));
    notification.show();
  }

  await openWatch(event.watchId, { autoTravelToHideout: true });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("watch:triggered", event);
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
  emitState();
}

function findWatch(id) {
  return store.watches.find((watch) => watch.id === id);
}

async function openWatch(id, { autoTravelToHideout = false } = {}) {
  const watch = findWatch(id);
  if (!watch) return false;
  const win = createBrowserWindow({ show: true, title: watch.name });
  await win.loadURL(watch.url);
  if (autoTravelToHideout) {
    await clickFirstTravelToHideout(win);
  }
  return true;
}

function registerIpc() {
  ipcMain.handle("state:get", () => publicState());
  ipcMain.handle("update:get-status", () => updateState);

  ipcMain.handle("watch:add", (_event, input) => {
    store.watches.unshift(sanitizeWatch(input));
    emitState();
    return publicState();
  });

  ipcMain.handle("watch:remove", (_event, id) => {
    clearWatchTimer(id);
    store.watches = store.watches.filter((watch) => watch.id !== id);
    store.events = store.events.filter((event) => event.watchId !== id);
    emitState();
    return publicState();
  });

  ipcMain.handle("watch:toggle", (_event, id) => {
    const watch = findWatch(id);
    if (!watch) return publicState();
    watch.enabled = !watch.enabled;
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
    autoUpdater.quitAndInstall(false, true);
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
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", () => {
  stopAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
