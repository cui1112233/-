const { randomUUID } = require('node:crypto');

class DesktopController {
  constructor({ runtime, accountStore, accountWindows, onState = () => {}, makeAccountId = randomUUID }) {
    if (!runtime || !accountStore || !accountWindows) throw new Error('runtime, accountStore and accountWindows are required');
    this.runtime = runtime;
    this.accountStore = accountStore;
    this.accountWindows = accountWindows;
    this.onState = onState;
    this.makeAccountId = makeAccountId;
    this.heartbeatTimer = null;
  }

  getState() {
    return this.runtime.getState();
  }

  broadcast() {
    const state = this.getState();
    this.onState(state);
    return state;
  }

  async pair(input) {
    await this.runtime.pair(input);
    this.broadcast();
    return this.getState();
  }

  addAccount() {
    const id = this.makeAccountId();
    const number = this.runtime.getState().accounts.length + 1;
    const account = this.runtime.addAccount({ id, name: `豆包账号 ${number}` });
    this.persistAccounts();
    this.accountWindows.open(account.id);
    this.broadcast();
    return account;
  }

  openAccount(id) {
    this.accountWindows.open(id);
    return this.runtime.getAccount?.(id) || null;
  }

  markAccountAvailable(id) {
    const account = this.runtime.markAccountAvailable(id);
    this.persistAccounts();
    this.broadcast();
    return account;
  }

  persistAccounts() {
    this.accountStore.save(this.runtime.getState().accounts);
  }

  async heartbeatOnce() {
    try {
      await this.runtime.heartbeat();
      this.broadcast();
      return true;
    } catch (error) {
      this.runtime.recordError(error);
      this.broadcast();
      return false;
    }
  }

  startHeartbeat(intervalMs = 15000) {
    this.stopHeartbeat();
    this.heartbeatOnce();
    this.heartbeatTimer = setInterval(() => this.heartbeatOnce(), intervalMs);
    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  shutdown() {
    this.stopHeartbeat();
    this.accountWindows.closeAll?.();
  }
}

module.exports = { DesktopController };
