const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const statePath = () => path.join(app.getPath('userData'), 'executor-state.bin');
let heartbeatTimer = null;
let state = { serverUrl: '', executorId: '', deviceToken: '', displayName: '' };

function normalizeServerUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('服务地址必须是 http 或 https');
  return url.origin;
}

function loadState() {
  try {
    const raw = fs.readFileSync(statePath());
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8');
    state = { ...state, ...JSON.parse(json) };
  } catch (_) { /* 首次运行没有本地状态 */ }
}

function saveState() {
  const json = JSON.stringify(state);
  const payload = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json);
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), payload, { mode: 0o600 });
}

async function request(pathname, options = {}) {
  const response = await fetch(`${state.serverUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || `请求失败（${response.status}）`);
  return payload;
}

async function heartbeat() {
  if (!state.serverUrl || !state.deviceToken) return { online: false, reason: '未配对' };
  await request('/api/local-executors/heartbeat', {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.deviceToken}` },
    body: { displayName: state.displayName }
  });
  return { online: true, executorId: state.executorId, displayName: state.displayName };
}

function startHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeat().catch(() => {});
  heartbeatTimer = setInterval(() => heartbeat().catch(() => {}), 30000);
}

app.whenReady().then(() => {
  loadState();
  const window = new BrowserWindow({
    width: 520, height: 660, minWidth: 460, minHeight: 580,
    title: '一战晟铭本地执行器',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  window.removeMenu();
  window.loadFile(path.join(__dirname, 'renderer.html'));
  if (state.deviceToken) startHeartbeat();
});

ipcMain.handle('executor:state', () => ({
  serverUrl: state.serverUrl, executorId: state.executorId, displayName: state.displayName,
  paired: Boolean(state.deviceToken), encryptionAvailable: safeStorage.isEncryptionAvailable()
}));

ipcMain.handle('executor:pair', async (_, input) => {
  const serverUrl = normalizeServerUrl(input.serverUrl);
  const code = String(input.code || '').trim().toUpperCase();
  const displayName = String(input.displayName || '').trim().slice(0, 128) || `Windows-${crypto.randomBytes(2).toString('hex')}`;
  if (!code) throw new Error('请输入平台设置页生成的配对码');
  state.serverUrl = serverUrl;
  const result = await request('/api/local-executors/pair', { method: 'POST', body: { code, displayName } });
  state.executorId = result.executorId;
  state.deviceToken = result.deviceToken;
  state.displayName = displayName;
  saveState();
  startHeartbeat();
  return { paired: true, executorId: state.executorId, displayName: state.displayName };
});

ipcMain.handle('executor:heartbeat', () => heartbeat());

ipcMain.handle('executor:unpair', () => {
  clearInterval(heartbeatTimer);
  state = { serverUrl: '', executorId: '', deviceToken: '', displayName: '' };
  try { fs.rmSync(statePath(), { force: true }); } catch (_) {}
  return { paired: false };
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
