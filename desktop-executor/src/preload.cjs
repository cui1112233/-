const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('executor', {
  state: () => ipcRenderer.invoke('executor:state'),
  pair: input => ipcRenderer.invoke('executor:pair', input),
  heartbeat: () => ipcRenderer.invoke('executor:heartbeat'),
  unpair: () => ipcRenderer.invoke('executor:unpair')
});
