const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('executor', {
  state: () => ipcRenderer.invoke('executor:state'),
  pair: input => ipcRenderer.invoke('executor:pair', input),
  heartbeat: () => ipcRenderer.invoke('executor:heartbeat'),
  checkUpdate: () => ipcRenderer.invoke('executor:check-update'),
  downloadUpdate: () => ipcRenderer.invoke('executor:download-update'),
  setAutoSubmit: enabled => ipcRenderer.invoke('executor:set-auto-submit', enabled),
  unpair: () => ipcRenderer.invoke('executor:unpair'),
  accounts: () => ipcRenderer.invoke('accounts:list'),
  addAccount: name => ipcRenderer.invoke('accounts:add', name),
  removeAccount: id => ipcRenderer.invoke('accounts:remove', id),
  claimJob: () => ipcRenderer.invoke('executor:claim-job'),
  copyJobPrompt: () => ipcRenderer.invoke('executor:copy-job-prompt'),
  openJob: accountId => ipcRenderer.invoke('executor:open-job', accountId),
  uploadResult: () => ipcRenderer.invoke('executor:upload-result'),
  failJob: message => ipcRenderer.invoke('executor:fail-job', message)
});
