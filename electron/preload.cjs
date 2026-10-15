const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("daemon", {
  getDeviceStatus: () => ipcRenderer.invoke("device:status"),
  refreshDeviceStatus: () => ipcRenderer.invoke("device:refresh"),
  onDeviceStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("device:status", listener);
    return () => ipcRenderer.removeListener("device:status", listener);
  },
  getInferenceConfig: () => ipcRenderer.invoke("inference:config"),
  generate: (prompt) => ipcRenderer.invoke("inference:generate", prompt),
  load: () => ipcRenderer.invoke("workspace:load"),
  save: (data) => ipcRenderer.invoke("workspace:save", data),
  saveArtifact: (artifact) => ipcRenderer.invoke("artifact:save", artifact),
  openArtifact: (id) => ipcRenderer.invoke("artifact:open", id),
  revealArtifact: (id) => ipcRenderer.invoke("artifact:reveal", id),
  getOutputDirectory: () => ipcRenderer.invoke("output:get"),
  chooseOutputDirectory: () => ipcRenderer.invoke("output:choose"),
});
