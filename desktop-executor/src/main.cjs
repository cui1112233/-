const { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Force the embedded Chromium renderer and the account-login partition to ask
// for Simplified Chinese. Some provider pages fall back to untranslated i18n
// keys when Electron sends the default English locale.
app.commandLine.appendSwitch('lang', 'zh-CN');

const statePath = () => path.join(app.getPath('userData'), 'executor-state.bin');
let heartbeatTimer = null;
let claimTimer = null;
let claimInFlight = false;
let state = { serverUrl: '', executorId: '', deviceToken: '', displayName: '', accounts: [], activeJob: null, autoSubmit: true };
const configuredAccountSessions = new Set();

function normalizeServerUrl(value) {
  const url = new URL(String(value || '').trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('服务地址必须是 http 或 https');
  return url.origin;
}

function platformOrigin() {
  const url = new URL(state.serverUrl);
  if (url.port === '14000') url.port = '3000';
  return url.origin;
}

function isNewerVersion(candidate, current) {
  const left = String(candidate || '').split('.').map(part => Number(part) || 0);
  const right = String(current || '').split('.').map(part => Number(part) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0);
  }
  return false;
}

async function checkForUpdate() {
  if (!state.serverUrl) throw new Error('请先完成平台配对');
  const response = await fetch(`${platformOrigin()}/downloads/local-executor/manifest.json`);
  const manifest = await response.json().catch(() => ({}));
  if (!response.ok || !manifest.version) throw new Error(manifest.error || '检查更新失败');
  const platformKey = process.platform === 'darwin' ? 'mac' : 'windows';
  const currentVersion = app.getVersion();
  return { currentVersion, latestVersion: manifest.version, updateAvailable: isNewerVersion(manifest.version, currentVersion), url: manifest.downloads?.[platformKey] || '' };
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

async function uploadVideo(jobId, filename) {
  if (!state.deviceToken || !state.serverUrl) throw new Error('执行器尚未完成配对');
  const stat = await fs.promises.stat(filename);
  if (!stat.isFile()) throw new Error('下载的视频文件不存在');
  if (stat.size > 512 * 1024 * 1024) throw new Error('视频超过平台允许的 512MB 回传上限');
  const body = new FormData();
  const extension = path.extname(filename).toLowerCase();
  const contentType = extension === '.webm' ? 'video/webm' : extension === '.mov' ? 'video/quicktime' : 'video/mp4';
  body.append('video', new Blob([await fs.promises.readFile(filename)], { type: contentType }), path.basename(filename));
  const response = await fetch(`${state.serverUrl}/api/local-executors/jobs/${encodeURIComponent(jobId)}/result`, {
    method: 'POST', headers: { Authorization: `Bearer ${state.deviceToken}` }, body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `视频回传失败（${response.status}）`);
  if (state.activeJob && state.activeJob.id === jobId) {
    state.activeJob = null;
    saveState();
  }
  return payload;
}

function prefillDoubaoPrompt(webContents, prompt) {
  const script = `(() => {
    const text = ${JSON.stringify(String(prompt || ''))};
    const candidates = [
      'textarea',
      '[contenteditable="true"]',
      'input[type="text"]'
    ];
    for (const selector of candidates) {
      for (const element of document.querySelectorAll(selector)) {
        if (element.offsetParent === null || element.disabled || element.readOnly) continue;
        if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
          const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
          setter ? setter.call(element, text) : (element.value = text);
        } else {
          element.textContent = text;
        }
        element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
        element.focus();
        return { ok: true, selector };
      }
    }
    return { ok: false };
  })()`;
  return webContents.executeJavaScript(script, true).catch(() => ({ ok: false }));
}

function autoSubmitDoubaoPrompt(webContents) {
  const script = `(() => {
    const labels = new Set(['生成', '立即生成', '开始生成', '生成视频']);
    const candidates = [...document.querySelectorAll('button, [role="button"]')]
      .filter(element => element.offsetParent !== null && !element.disabled && labels.has((element.innerText || element.textContent || '').trim()));
    const target = candidates.at(-1);
    if (!target) return { ok: false, reason: '未找到可点击的生成按钮' };
    target.click();
    return { ok: true, label: (target.innerText || target.textContent || '').trim() };
  })()`;
  return webContents.executeJavaScript(script, true).catch(() => ({ ok: false, reason: '页面尚未就绪' }));
}

async function tryAutoSubmitDoubaoPrompt(webContents) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await autoSubmitDoubaoPrompt(webContents);
    if (result.ok) return result;
    await new Promise(resolve => setTimeout(resolve, 600));
  }
  return { ok: false, reason: '未找到生成按钮，请在豆包页面手动确认' };
}

function configureAccountSession(account) {
  const accountSession = session.fromPartition(`persist:doubao-${account.id}`);
  if (configuredAccountSessions.has(account.id)) return accountSession;
  configuredAccountSessions.add(account.id);
  accountSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: { ...details.requestHeaders, 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.2' } });
  });
  accountSession.on('will-download', (event, item) => {
    const job = state.activeJob;
    if (!job) return;
    const downloadsDir = path.join(app.getPath('downloads'), '一战晟铭视频回传');
    fs.mkdirSync(downloadsDir, { recursive: true });
    const savedFile = path.join(downloadsDir, `${job.id}-${Date.now()}-${item.getFilename()}`);
    item.setSavePath(savedFile);
    item.once('done', async (_, status) => {
      if (status !== 'completed') return;
      try { await uploadVideo(job.id, savedFile); } catch (_) { /* The user can retry from the executor panel. */ }
    });
  });
  return accountSession;
}

function availableAccounts() {
  const now = Date.now();
  return state.accounts.filter(account => !account.unavailableUntil || account.unavailableUntil <= now);
}

function accountRestrictionReason(text) {
  const value = String(text || '').replace(/\s+/g, ' ');
  const patterns = [
    [/次数已用完|次数不足|额度不足|额度已用完|今日.*上限|达到.*上限/, '生成额度已用完'],
    [/登录失效|请重新登录|登录已过期|账号已退出/, '登录状态已失效'],
    [/账号异常|账号受限|暂时无法使用|操作频繁/, '账号当前受限']
  ];
  const match = patterns.find(([pattern]) => pattern.test(value));
  return match ? match[1] : '';
}

async function detectAccountRestriction(webContents) {
  const text = await webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 12000) : ""', true).catch(() => '');
  return accountRestrictionReason(text);
}

async function markAccountUnavailable(account, reason) {
  account.status = `暂不可用：${reason}`;
  account.unavailableUntil = Date.now() + 6 * 60 * 60 * 1000;
  account.lastFailureReason = reason;
  saveState();
  await request(`/api/local-executors/jobs/${encodeURIComponent(state.activeJob.id)}/status`, {
    method: 'POST', headers: { Authorization: `Bearer ${state.deviceToken}` }, body: { status: 'running', message: `${account.name} ${reason}，正在切换下一账号` }
  }).catch(() => {});
}

async function openJobForAccount(job, account) {
  const accountSession = configureAccountSession(account);
  const taskWindow = new BrowserWindow({ width: 1120, height: 760, title: `豆包生成：${account.name}`, webPreferences: { partition: `persist:doubao-${account.id}`, contextIsolation: true, nodeIntegration: false } });
  taskWindow.loadURL('https://www.doubao.com/?locale=zh-CN');
  taskWindow.webContents.once('did-finish-load', async () => {
    const result = await prefillDoubaoPrompt(taskWindow.webContents, job.prompt);
    if (!result.ok) {
      taskWindow.setTitle(`豆包生成：${account.name}（请手动粘贴提示词）`);
      return;
    }
    if (!state.autoSubmit) {
      taskWindow.setTitle(`豆包生成：${account.name}（提示词已填入，等待确认）`);
      return;
    }
    const submitted = await tryAutoSubmitDoubaoPrompt(taskWindow.webContents);
    taskWindow.setTitle(submitted.ok ? `豆包生成：${account.name}（已自动点击${submitted.label}）` : `豆包生成：${account.name}（${submitted.reason}）`);
  });
  const restrictionTimer = setInterval(async () => {
    if (taskWindow.isDestroyed() || !state.activeJob || state.activeJob.id !== job.id) return clearInterval(restrictionTimer);
    const reason = await detectAccountRestriction(taskWindow.webContents);
    if (!reason) return;
    clearInterval(restrictionTimer);
    await markAccountUnavailable(account, reason);
    if (!taskWindow.isDestroyed()) taskWindow.close();
    await dispatchActiveJob();
  }, 5000);
  state.activeJob = { ...job, accountId: account.id, accountName: account.name };
  saveState();
  await request(`/api/local-executors/jobs/${encodeURIComponent(job.id)}/status`, { method: 'POST', headers: { Authorization: `Bearer ${state.deviceToken}` }, body: { status: 'running', message: `已使用 ${account.name} 打开豆包生成窗口` } });
  return { accountName: account.name, promptLength: job.prompt.length, downloadsWatched: true, session: Boolean(accountSession) };
}

async function dispatchActiveJob() {
  const job = state.activeJob;
  if (!job) return null;
  const account = availableAccounts().find(item => item.id !== job.accountId) || availableAccounts()[0];
  if (!account) {
    await request(`/api/local-executors/jobs/${encodeURIComponent(job.id)}/status`, { method: 'POST', headers: { Authorization: `Bearer ${state.deviceToken}` }, body: { status: 'failed', message: '所有本地豆包账号均不可用' } });
    state.activeJob = null; saveState(); return null;
  }
  return openJobForAccount({ ...job, accountId: undefined }, account);
}

async function claimAndDispatch() {
  if (claimInFlight || state.activeJob || !state.deviceToken || !availableAccounts().length) return null;
  claimInFlight = true;
  try {
    const result = await request('/api/local-executors/jobs/claim', { method: 'POST', headers: { Authorization: `Bearer ${state.deviceToken}` } });
    if (!result.job) return null;
    state.activeJob = result.job; saveState();
    return dispatchActiveJob();
  } finally { claimInFlight = false; }
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
  clearInterval(claimTimer);
  claimAndDispatch().catch(() => {});
  claimTimer = setInterval(() => claimAndDispatch().catch(() => {}), 15000);
}

app.whenReady().then(() => {
  loadState();
  state.accounts.forEach(configureAccountSession);
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
  paired: Boolean(state.deviceToken), encryptionAvailable: safeStorage.isEncryptionAvailable(), activeJob: state.activeJob, autoSubmit: state.autoSubmit !== false
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

ipcMain.handle('executor:check-update', () => checkForUpdate());

ipcMain.handle('executor:download-update', async () => {
  const update = await checkForUpdate();
  if (!update.updateAvailable || !update.url) return update;
  await shell.openExternal(update.url);
  return update;
});

ipcMain.handle('executor:set-auto-submit', (_, enabled) => {
  state.autoSubmit = Boolean(enabled);
  saveState();
  return state.autoSubmit;
});

ipcMain.handle('executor:unpair', () => {
  clearInterval(heartbeatTimer);
  clearInterval(claimTimer);
  state = { serverUrl: '', executorId: '', deviceToken: '', displayName: '', accounts: [], activeJob: null, autoSubmit: true };
  try { fs.rmSync(statePath(), { force: true }); } catch (_) {}
  return { paired: false };
});

ipcMain.handle('accounts:list', () => state.accounts.map(({ id, name, status }) => ({ id, name, status })));
ipcMain.handle('accounts:add', (_, rawName) => {
  const name = String(rawName || '').trim().slice(0, 80);
  if (!name) throw new Error('请输入账号备注');
  const account = { id: crypto.randomUUID(), name, status: '未登录' };
  state.accounts.push(account); saveState();
  configureAccountSession(account);
  const loginWindow = new BrowserWindow({ width: 1120, height: 760, title: `登录豆包：${name}`, webPreferences: { partition: `persist:doubao-${account.id}`, contextIsolation: true, nodeIntegration: false } });
  loginWindow.loadURL('https://www.doubao.com/?locale=zh-CN');
  loginWindow.on('close', () => { account.status = '已登录（请在任务前确认）'; saveState(); });
  return account;
});
ipcMain.handle('accounts:remove', async (_, id) => {
  const index = state.accounts.findIndex(item => item.id === id);
  if (index < 0) return;
  await session.fromPartition(`persist:doubao-${id}`).clearStorageData();
  state.accounts.splice(index, 1); saveState();
});

ipcMain.handle('executor:claim-job', async () => {
  const result = await request('/api/local-executors/jobs/claim', {
    method: 'POST', headers: { Authorization: `Bearer ${state.deviceToken}` }
  });
  state.activeJob = result.job || null;
  saveState();
  return state.activeJob;
});

ipcMain.handle('executor:copy-job-prompt', () => {
  if (!state.activeJob?.prompt) throw new Error('当前没有可复制的任务提示词');
  clipboard.writeText(state.activeJob.prompt);
  return true;
});

ipcMain.handle('executor:open-job', async (_, accountId) => {
  const job = state.activeJob;
  const account = state.accounts.find(item => item.id === accountId) || state.accounts[0];
  if (!job) throw new Error('请先领取一个任务');
  if (!account) throw new Error('请先添加并登录一个豆包账号');
  return openJobForAccount(job, account);
});

ipcMain.handle('executor:upload-result', async () => {
  if (!state.activeJob) throw new Error('当前没有等待回传的任务');
  const selected = await dialog.showOpenDialog({ title: '选择已下载的生成视频', properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4', 'mov', 'webm', 'mkv'] }] });
  if (selected.canceled || !selected.filePaths[0]) return { cancelled: true };
  return uploadVideo(state.activeJob.id, selected.filePaths[0]);
});

ipcMain.handle('executor:fail-job', async (_, message) => {
  if (!state.activeJob) throw new Error('当前没有运行中的任务');
  const jobID = state.activeJob.id;
  await request(`/api/local-executors/jobs/${encodeURIComponent(jobID)}/status`, {
    method: 'POST', headers: { Authorization: `Bearer ${state.deviceToken}` }, body: { status: 'failed', message: String(message || '').trim() || '本地执行器中止任务' }
  });
  state.activeJob = null;
  saveState();
  return true;
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
