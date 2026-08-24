const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('executor', {
  state: () => ipcRenderer.invoke('executor:state'),
  pair: input => ipcRenderer.invoke('executor:pair', input),
  heartbeat: () => ipcRenderer.invoke('executor:heartbeat'),
  unpair: () => ipcRenderer.invoke('executor:unpair'),
  accounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: name => ipcRenderer.invoke('accounts:add', name),
  removeAccount: id => ipcRenderer.invoke('accounts:remove', id)
});
