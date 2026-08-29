function cleanName(value) {
  return typeof value === 'string' ? value.trim().slice(0, 120) : '';
}

function unavailableStatus() {
  return {
    state: 'unavailable',
    accountName: '',
    message: '视频管理系统账号验证能力暂不可用'
  };
}

function unavailableRelogin() {
  return {
    state: 'unavailable',
    loginUrl: '',
    message: '视频管理系统重新登录能力暂不可用'
  };
}

function safeLoginUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch (_) {
    return '';
  }
}

async function resolveVideoManagementAccountStatus({ accountAdapter, username } = {}) {
  if (!accountAdapter || typeof accountAdapter.getStatus !== 'function') return unavailableStatus();
  try {
    const result = await accountAdapter.getStatus(username);
    const accountName = cleanName(result?.accountName);
    if (result?.online === true && accountName) {
      return { state: 'online', accountName };
    }
    return {
      state: 'login_required',
      accountName: '',
      message: '账号登录状态已失效'
    };
  } catch (_) {
    return {
      state: 'login_required',
      accountName: '',
      message: '账号登录状态已失效'
    };
  }
}

async function startVideoManagementAccountRelogin({ accountAdapter, username } = {}) {
  if (!accountAdapter || typeof accountAdapter.startRelogin !== 'function') return unavailableRelogin();
  try {
    const result = await accountAdapter.startRelogin(username);
    const loginUrl = safeLoginUrl(result?.loginUrl);
    if (!loginUrl) return unavailableRelogin();
    return { state: 'started', loginUrl };
  } catch (_) {
    return unavailableRelogin();
  }
}

module.exports = {
  resolveVideoManagementAccountStatus,
  startVideoManagementAccountRelogin
};
