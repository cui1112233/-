const { ExecutorApiClient } = require('./api-client');
const { AccountPool } = require('./account-pool');

class DesktopRuntime {
  constructor({
    deviceStore,
    apiFactory = baseUrl => new ExecutorApiClient({ baseUrl }),
    deviceName,
    platform,
    version,
    accounts = []
  }) {
    if (!deviceStore) throw new Error('deviceStore is required');
    this.deviceStore = deviceStore;
    this.apiFactory = apiFactory;
    this.deviceName = String(deviceName || 'YiZhan Executor');
    this.os = normalizeOs(platform);
    this.version = String(version || '0.0.0');
    this.accountPool = new AccountPool(accounts);
    this.credential = null;
    this.api = null;
    this.automationEnabled = false;
    this.currentTask = null;
    this.lastHeartbeatAt = null;
    this.lastError = null;
    this.restorePairing();
  }

  restorePairing() {
    const stored = this.deviceStore.load();
    if (!stored) return null;
    if (!stored.baseUrl || !stored.executorId || !stored.token) throw new Error('stored pairing is incomplete');
    this.credential = {
      baseUrl: normalizeBaseUrl(stored.baseUrl),
      executorId: String(stored.executorId),
      token: String(stored.token)
    };
    this.api = this.apiFactory(this.credential.baseUrl);
    return this.getState().pairing;
  }

  async pair({ baseUrl, code }) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    const normalizedCode = String(code || '').trim();
    if (!normalizedCode) throw new Error('pairing code is required');
    const api = this.apiFactory(normalizedBaseUrl);
    const response = await api.pair({
      code: normalizedCode,
      deviceName: this.deviceName,
      platform: 'doubao',
      os: this.os,
      version: this.version
    });
    if (!response?.executorId || !response?.token) throw new Error('pair response is incomplete');
    this.deviceStore.save({
      baseUrl: normalizedBaseUrl,
      executorId: response.executorId,
      token: response.token
    });
    this.credential = {
      baseUrl: normalizedBaseUrl,
      executorId: String(response.executorId),
      token: String(response.token)
    };
    this.api = api;
    this.lastError = null;
    return this.getState();
  }

  addAccount({ id, name }) {
    const accountId = String(id || '').trim();
    if (!accountId) throw new Error('account id is required');
    this.accountPool.upsert({
      id: accountId,
      name: String(name || accountId),
      state: 'auth_required'
    });
    return this.getAccount(accountId);
  }

  markAccountAvailable(id) {
    if (!this.accountPool.setState(id, 'available')) throw new Error('account not found');
    return this.getAccount(id);
  }

  setAccountState(id, state) {
    if (!this.accountPool.setState(id, state)) throw new Error('account not found');
    return this.getAccount(id);
  }

  getAccount(id) {
    return this.accountPool.list().find(item => item.id === id) || null;
  }

  setAutomationEnabled(enabled) {
    if (enabled) {
      throw new Error('live Doubao adapter is not installed; automation stays disabled');
    }
    this.automationEnabled = false;
    return this.getState();
  }

  async heartbeat() {
    if (!this.credential || !this.api) return null;
    const response = await this.api.heartbeat(this.credential.token, {
      deviceName: this.deviceName,
      os: this.os,
      version: this.version,
      accounts: this.accountPool.summary()
    });
    this.lastHeartbeatAt = new Date().toISOString();
    this.lastError = null;
    return response;
  }

  recordError(error) {
    this.lastError = error?.message || String(error);
  }

  getState() {
    return {
      pairing: this.credential
        ? { paired: true, baseUrl: this.credential.baseUrl, executorId: this.credential.executorId }
        : { paired: false, baseUrl: '', executorId: '' },
      accounts: this.accountPool.list().map(({ id, name, state, jobId }) => ({ id, name, state, jobId: jobId || null })),
      automation: {
        enabled: this.automationEnabled,
        ready: false,
        reason: '真实豆包网页接入完成前不可开启'
      },
      currentTask: this.currentTask,
      lastHeartbeatAt: this.lastHeartbeatAt,
      lastError: this.lastError
    };
  }
}

function normalizeBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(text)) throw new Error('V78 server address must start with http:// or https://');
  return text;
}

function normalizeOs(platform) {
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  return String(platform || 'unknown');
}

module.exports = { DesktopRuntime, normalizeBaseUrl, normalizeOs };
