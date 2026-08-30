const { readConfig, ensureReadyConfig } = require('./shared');
const { governanceStoreForMemberStore, quotaState } = require('./team-governance-store');

function accessError(message, code, status = 403) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function resolveTeamAuthorization({ memberStore, usageStore, username, scope = 'text' } = {}) {
  if (!memberStore || !username) throw accessError('无法解析 API 权限', 'API_ACCESS_INVALID', 500);
  const member = memberStore.getMember(username);
  if (!member || !member.active) throw accessError('账号不可用', 'ACCOUNT_INACTIVE', 403);

  let billedTo = username;
  let teamOwner = ['dev', 'manager'].includes(member.role) ? username : null;
  let memberQuota = null;

  if (member.role === 'member') {
    if (!memberStore.canUseApi(username, scope)) {
      throw accessError('当前账号尚未获得该类型 API 使用权限，请联系管理员。', 'API_NOT_AUTHORIZED', 403);
    }
    if (!member.boundTo) {
      throw accessError('当前账号尚未绑定管理员，无法使用团队 API。', 'API_MANAGER_MISSING', 403);
    }
    const manager = memberStore.getMember(member.boundTo);
    if (!manager || !manager.active || !['dev', 'manager'].includes(manager.role)) {
      throw accessError('团队 AI 服务当前不可用，请联系管理员。', 'API_MANAGER_UNAVAILABLE', 403);
    }
    billedTo = manager.username;
    teamOwner = manager.username;

    if (usageStore) {
      const monthly = usageStore.summaryForUser(username, 'month');
      memberQuota = quotaState(monthly.totalTokens, member.monthlyTokenLimit);
      if (memberQuota.level === 'exhausted') {
        throw accessError('本月个人 API 额度已用完，请联系管理员调整额度。', 'API_QUOTA_EXCEEDED', 429);
      }
    }
  }

  let teamQuota = null;
  if (teamOwner && usageStore) {
    const governance = governanceStoreForMemberStore(memberStore).get(teamOwner);
    const monthlyTeam = usageStore.summaryForTeam(teamOwner, 'month');
    teamQuota = quotaState(monthlyTeam.totalTokens, governance.monthlyTokenLimit);
    if (teamQuota.level === 'exhausted') {
      throw accessError('本月团队 API 总额度已用完，请联系管理员或 DEV 调整额度。', 'TEAM_API_QUOTA_EXCEEDED', 429);
    }
  }

  return { member, billedTo, teamOwner, scope, memberQuota, teamQuota };
}

function resolveApiAccess({ accountStore, memberStore, usageStore, username, scope = 'text', configReader = readConfig } = {}) {
  if (!accountStore) throw accessError('无法解析 API 权限', 'API_ACCESS_INVALID', 500);
  const authorization = resolveTeamAuthorization({ memberStore, usageStore, username, scope });
  const { member, billedTo } = authorization;
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

  return { ...authorization, config };
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
    pricing: access.scope === 'image' ? null : access.config?.pricing,
    metadata
  });
}

module.exports = { resolveApiAccess, resolveTeamAuthorization, recordUsageFromPayload };
