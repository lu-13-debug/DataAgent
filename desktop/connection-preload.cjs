const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dataagentConnection', Object.freeze({
  connect: serverUrl => ipcRenderer.invoke('dataagent:connect', serverUrl),
}));
