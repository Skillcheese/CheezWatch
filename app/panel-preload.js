// Exposes a receive-only feed to the panel. Nothing here reaches the game view.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("companion", {
  onObserved: (callback) => ipcRenderer.on("observed", (_e, event) => callback(event)),
  togglePanel: () => ipcRenderer.send("panel:toggle"),
});
