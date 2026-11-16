const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("daemon", {
  getPreferences: () => ipcRenderer.invoke("preferences:get"),
  setPreferredName: (name) => ipcRenderer.invoke("preferences:name", name),
  getDeviceStatus: () => ipcRenderer.invoke("device:status"),
  refreshDeviceStatus: () => ipcRenderer.invoke("device:refresh"),
  onDeviceStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("device:status", listener);
    return () => ipcRenderer.removeListener("device:status", listener);
  },
  getInferenceConfig: () => ipcRenderer.invoke("inference:config"),
  setLlmEndpoint: (endpoint) => ipcRenderer.invoke("inference:endpoint", endpoint),
  generate: (prompt) => ipcRenderer.invoke("inference:generate", prompt),
  transcribeAudio: (data) => ipcRenderer.invoke("stt:transcribe", data),
  load: () => ipcRenderer.invoke("workspace:load"),
  save: (data) => ipcRenderer.invoke("workspace:save", data),
  saveArtifact: (artifact) => ipcRenderer.invoke("artifact:save", artifact),
  readPresentation: (id) =>
    ipcRenderer.invoke("artifact:read-presentation", id),
  readDocument: (id) => ipcRenderer.invoke("artifact:read-document", id),
  openArtifact: (id) => ipcRenderer.invoke("artifact:open", id),
  revealArtifact: (id) => ipcRenderer.invoke("artifact:reveal", id),
  getOutputDirectory: () => ipcRenderer.invoke("output:get"),
  chooseOutputDirectory: () => ipcRenderer.invoke("output:choose"),
});
