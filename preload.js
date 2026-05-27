const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("poe2Market", {
  addWatch: (watch) => ipcRenderer.invoke("watch:add", watch),
  checkWatch: (id) => ipcRenderer.invoke("watch:check", id),
  clearEvents: () => ipcRenderer.invoke("events:clear"),
  getState: () => ipcRenderer.invoke("state:get"),
  getUpdateStatus: () => ipcRenderer.invoke("update:get-status"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  openLogin: () => ipcRenderer.invoke("browser:login"),
  openWatch: (id) => ipcRenderer.invoke("watch:open", id),
  removeWatch: (id) => ipcRenderer.invoke("watch:remove", id),
  startAll: () => ipcRenderer.invoke("watch:start-all"),
  stopAll: () => ipcRenderer.invoke("watch:stop-all"),
  toggleWatch: (id) => ipcRenderer.invoke("watch:toggle", id),
  onStateChanged: (callback) => {
    ipcRenderer.on("state:changed", (_event, state) => callback(state));
  },
  onUpdateChanged: (callback) => {
    ipcRenderer.on("update:changed", (_event, updateState) => callback(updateState));
  },
  onTriggered: (callback) => {
    ipcRenderer.on("watch:triggered", (_event, event) => callback(event));
  },
});
