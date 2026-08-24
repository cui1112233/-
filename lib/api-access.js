const { readConfig, ensureReadyConfig } = require('./shared');

function accessError(message, code, status = 403) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function resolveApiAccess({ accountStore, memberStore, usageStore, username, scope = 'text', configReader = readConfig } = {}) {
  if (!accountStore || !memberStore || !username) throw accessError('无法解析 API 权限', 'API_ACCESS_INVALID', 500);
  const member = memberStore.getMember(username);
  if (!member || !member.active) throw accessError('账号不可用', 'ACCOUNT_INACTIVE', 403);

  let billedTo = username;
  let teamOwner = member.role === 'manager' ? username : null;

  if (member.role === 'member') {
    if (!memberStore.canUseApi(username, scope)) {
      throw accessError('当前账号尚未获得 API 使用权限，请联系管理员。', 'API_NOT_AUTHORIZED', 403);
    }
    if (!member.boundTo) {
      throw accessError('当前账号尚未绑定管理员，无法使用团队 API。', 'API_MANAGER_MISSING', 403);
    }
    const manager = memberStore.getMember(member.boundTo);
    if (!manager || !manager.active || manager.role !== 'manager') {
      throw accessError('团队 AI 服务当前不可用，请联系管理员。', 'API_MANAGER_UNAVAILABLE', 403);
    }
    billedTo = manager.username;
    teamOwner = manager.username;

    if (member.monthlyTokenLimit !== null && usageStore) {
      const monthly = usageStore.summaryForUser(username, 'month');
      if (monthly.totalTokens >= member.monthlyTokenLimit) {
        throw accessError('本月 API 额度已用完，请联系管理员调整额度。', 'API_QUOTA_EXCEEDED', 429);
      }
    }
  }

  const config = configReader(billedTo);
  try {
    if (scope === 'image') {
      const image = config?.image || {};
      ensureReadyConfig({ baseUrl: image.baseUrl, model: image.model, apiKey: image.apiKey });
    } else {
      ensureReadyConfig(config);
    }
  } catch (error) {
    if (member.role === 'member') {
      throw accessError('团队 AI 服务尚未配置完成，请联系管理员。', 'API_MANAGER_CONFIG_MISSING', 422);
    }
    throw error;
  }

  return { member, config, billedTo, teamOwner, scope };
}

function recordUsageFromPayload(usageStore, access, payload, { feature = 'unknown', status = 'success', metadata = null } = {}) {
  if (!usageStore || !access) return null;
  return usageStore.record({
    username: access.member.username,
    billedTo: access.billedTo,
    teamOwner: access.teamOwner,
    feature,
    provider: access.config?.provider || '',
    model: access.scope === 'image' ? (access.config?.image?.model || '') : (access.config?.model || ''),
    status,
    usage: payload?.usage,
    metadata
  });
}

module.exports = { resolveApiAccess, recordUsageFromPayload };
