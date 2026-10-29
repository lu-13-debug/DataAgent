const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('dataagentDesktop', {
  setTheme: theme => ipcRenderer.send('appearance:set-theme', theme),
  onSystemThemeChanged: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, dark) => callback(Boolean(dark));
    ipcRenderer.on('appearance:system-theme', listener);
    return () => ipcRenderer.removeListener('appearance:system-theme', listener);
  },
  setTrayState: state => ipcRenderer.invoke('dataagent:tray-state', state),
  showWindow: () => ipcRenderer.invoke('dataagent:show-window'),
  setTaskSummaries: summaries => ipcRenderer.invoke('dataagent:tray-summary', summaries),
  onNewAnalysis: callback => {
    if (typeof callback !== 'function') return () => {};
    const listener = () => callback();
    ipcRenderer.on('dataagent:tray-new', listener);
    return () => ipcRenderer.removeListener('dataagent:tray-new', listener);
  },
});
