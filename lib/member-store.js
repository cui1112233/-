const crypto = require('node:crypto');
const path = require('node:path');

const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');

const ROLES = new Set(['dev', 'manager', 'member']);
const API_CAPABILITY = 'api:use';
const API_SCOPES = new Set(['*', 'text', 'image', 'tts', 'video']);

function memberError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDisplayName(value, fallback) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw memberError('显示名称不合法');
  const text = value.trim();
  if (!text || text.length > 40) throw memberError('显示名称需为 1-40 个字符');
  return text;
}

function normalizeQuota(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 10_000_000_000) {
    throw memberError('月度 Token 额度不合法');
  }
  return number;
}

function normalizeAvatarUrl(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 500 || !value.startsWith('/user-content/avatars/')) {
    throw memberError('头像地址不合法');
  }
  return value;
}

function createMemberStore({ systemDir, accountStore } = {}) {
  if (!systemDir) throw new Error('systemDir is required');
  if (!accountStore) throw new Error('accountStore is required');

  const files = {
    profiles: path.join(systemDir, 'member-profiles.json'),
    grants: path.join(systemDir, 'team-grants.json'),
    audit: path.join(systemDir, 'team-audit.json'),
    lock: path.join(systemDir, 'member-store.lock')
  };

  function withLock(operation) {
    return withJsonLock(files.lock, operation);
  }

  function readArray(filePath, label) {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return [];
    if (!Array.isArray(result.value)) throw new Error(`Invalid ${label} store`);
    return result.value;
  }

  function readStateUnsafe() {
    return {
      profiles: readArray(files.profiles, 'member profile'),
      grants: readArray(files.grants, 'team grant'),
      audit: readArray(files.audit, 'team audit')
    };
  }

  function writeStateUnsafe(state, keys = ['profiles', 'grants', 'audit']) {
    for (const key of keys) writeJsonAtomic(files[key], state[key]);
  }

  function account(username) {
    return accountStore.getAccount(username);
  }

  function rawProfile(state, username) {
    return state.profiles.find(item => item.username === username) || null;
  }

  function effectiveRoleFor(accountValue, profile) {
    if (!accountValue) return null;
    if (accountValue.isOwner) return 'dev';
    return ROLES.has(profile?.role) ? profile.role : 'member';
  }

  function mergedMember(state, accountValue) {
    if (!accountValue) return null;
    const profile = rawProfile(state, accountValue.username);
    const role = effectiveRoleFor(accountValue, profile);
    const apiScopes = state.grants
      .filter(grant => grant.subject === accountValue.username && grant.capability === API_CAPABILITY)
      .map(grant => grant.scope);
    return {
      ...accountValue,
      displayName: profile?.displayName || accountValue.username,
      avatarUrl: profile?.avatarUrl || null,
      role,
      boundTo: role === 'member' ? (profile?.boundTo || null) : null,
      monthlyTokenLimit: profile?.monthlyTokenLimit ?? null,
      apiScopes,
      apiEnabled: apiScopes.length > 0
    };
  }

  function getMemberUnsafe(state, username) {
    return mergedMember(state, account(username));
  }

  function ensureActiveMember(state, username, message = '账号不存在或已停用') {
    const member = getMemberUnsafe(state, username);
    if (!member || !member.active) throw memberError(message, 'NOT_FOUND');
    return member;
  }

  function appendAudit(state, actor, action, target, before, after) {
    const entry = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor,
      action,
      target,
      before: before === undefined ? null : clone(before),
      after: after === undefined ? null : clone(after)
    };
    state.audit.push(entry);
    return entry;
  }

  function upsertProfile(state, username, patch) {
    const now = new Date().toISOString();
    let profile = rawProfile(state, username);
    if (!profile) {
      profile = {
        username,
        displayName: username,
        avatarUrl: null,
        role: 'member',
        boundTo: null,
        monthlyTokenLimit: null,
        createdAt: now,
        updatedAt: now
      };
      state.profiles.push(profile);
    }
    Object.assign(profile, patch, { updatedAt: now });
    return profile;
  }

  function validateTeamOwnerBinding(state, boundTo, subjectUsername) {
    if (!boundTo) return null;
    if (boundTo === subjectUsername) throw memberError('成员不能绑定到自己');
    const owner = ensureActiveMember(state, boundTo, '绑定的团队负责人不存在或已停用');
    if (!['dev', 'manager'].includes(owner.role)) throw memberError('成员只能绑定到 DEV 或 MANAGER');
    return owner;
  }

  function ensureDev(state, actorUsername) {
    const actor = ensureActiveMember(state, actorUsername);
    if (actor.role !== 'dev') throw memberError('仅 DEV 可执行此操作', 'FORBIDDEN');
    return actor;
  }

  function ensureCanManageMember(state, actorUsername, targetUsername) {
    const actor = ensureActiveMember(state, actorUsername);
    const target = ensureActiveMember(state, targetUsername);
    if (target.isOwner) throw memberError('Owner 不可被其他成员管理', 'FORBIDDEN');
    if (actor.role === 'dev') return { actor, target };
    if (actor.role === 'manager' && target.role === 'member' && target.boundTo === actor.username) {
      return { actor, target };
    }
    throw memberError('无权管理该成员', 'FORBIDDEN');
  }

  function getMember(username) {
    return withLock(() => getMemberUnsafe(readStateUnsafe(), username));
  }

  function listMembers() {
    return withLock(() => {
      const state = readStateUnsafe();
      return accountStore.listAccounts().map(item => mergedMember(state, item));
    });
  }

  function updateOwnProfile(username, { displayName, avatarUrl } = {}) {
    return withLock(() => {
      const state = readStateUnsafe();
      const current = ensureActiveMember(state, username);
      const before = { displayName: current.displayName, avatarUrl: current.avatarUrl };
      upsertProfile(state, username, {
        displayName: normalizeDisplayName(displayName, current.displayName),
        avatarUrl: normalizeAvatarUrl(avatarUrl, current.avatarUrl)
      });
      const afterMember = getMemberUnsafe(state, username);
      const after = { displayName: afterMember.displayName, avatarUrl: afterMember.avatarUrl };
      if (JSON.stringify(before) !== JSON.stringify(after)) appendAudit(state, username, 'profile.changed', username, before, after);
      writeStateUnsafe(state, ['profiles', 'audit']);
      return afterMember;
    });
  }

  function createManagedMember(actorUsername, {
    username,
    password,
    displayName,
    role = 'member',
    boundTo,
    monthlyTokenLimit = null,
    apiEnabled = false
  } = {}) {
    return withLock(() => {
      const state = readStateUnsafe();
      const actor = ensureActiveMember(state, actorUsername);
      let nextRole = ROLES.has(role) ? role : 'member';
      let nextBoundTo = boundTo || null;

      if (actor.role === 'manager') {
        nextRole = 'member';
        nextBoundTo = actor.username;
      } else if (actor.role !== 'dev') {
        throw memberError('仅 DEV 或 MANAGER 可创建成员', 'FORBIDDEN');
      }

      if (nextRole === 'member') {
        validateTeamOwnerBinding(state, nextBoundTo, username);
        if (apiEnabled && !nextBoundTo) throw memberError('未绑定团队负责人的成员不能启用 API');
      } else {
        nextBoundTo = null;
      }

      // All validation above must finish before the durable account record is created.
      const nextDisplayName = normalizeDisplayName(displayName, username);
      const nextMonthlyTokenLimit = normalizeQuota(monthlyTokenLimit);
      const createdAccount = accountStore.createAccount({ username, password, active: true });
      const now = new Date().toISOString();
      state.profiles.push({
        username: createdAccount.username,
        displayName: nextDisplayName,
        avatarUrl: null,
        role: nextRole,
        boundTo: nextBoundTo,
        monthlyTokenLimit: nextMonthlyTokenLimit,
        createdAt: now,
        updatedAt: now
      });
      appendAudit(state, actor.username, 'member.created', createdAccount.username, null, {
        role: nextRole,
        boundTo: nextBoundTo
      });

      if (apiEnabled && nextRole === 'member') {
        const grant = {
          id: crypto.randomUUID(),
          at: now,
          actor: actor.username,
          subject: createdAccount.username,
          capability: API_CAPABILITY,
          scope: '*'
        };
        state.grants.push(grant);
        appendAudit(state, actor.username, 'api.enabled', createdAccount.username, null, grant);
      }

      writeStateUnsafe(state);
      return getMemberUnsafe(state, createdAccount.username);
    });
  }

  function updateManagedMember(actorUsername, targetUsername, patch = {}) {
    return withLock(() => {
      const state = readStateUnsafe();
      const { actor, target } = ensureCanManageMember(state, actorUsername, targetUsername);
      const before = clone(target);
      let nextRole = target.role;
      let nextBoundTo = target.boundTo;

      if (actor.role === 'dev' && patch.role !== undefined) {
        if (!ROLES.has(patch.role)) throw memberError('角色不合法');
        nextRole = patch.role;
      } else if (actor.role !== 'dev' && patch.role !== undefined && patch.role !== target.role) {
        throw memberError('MANAGER 无权修改角色', 'FORBIDDEN');
      }

      if (actor.role === 'dev' && patch.boundTo !== undefined) nextBoundTo = patch.boundTo || null;
      else if (actor.role !== 'dev' && patch.boundTo !== undefined && patch.boundTo !== target.boundTo) {
        throw memberError('MANAGER 无权转移成员', 'FORBIDDEN');
      }

      if (target.role === 'manager' && nextRole !== 'manager') {
        const reports = accountStore.listAccounts()
          .map(item => mergedMember(state, item))
          .filter(item => item.role === 'member' && item.boundTo === target.username);
        if (reports.length) throw memberError(`请先转移该 MANAGER 旗下的 ${reports.length} 名成员`, 'CONFLICT');
      }

      if (nextRole === 'member') validateTeamOwnerBinding(state, nextBoundTo, target.username);
      else nextBoundTo = null;

      const transferredToAnotherManager = target.role === 'member'
        && nextRole === 'member'
        && before.boundTo !== nextBoundTo;
      const revokedScopes = transferredToAnotherManager
        ? state.grants.filter(grant => grant.subject === target.username && grant.capability === API_CAPABILITY)
        : [];
      if (revokedScopes.length) {
        state.grants = state.grants.filter(grant => !revokedScopes.some(scope => scope.id === grant.id));
        appendAudit(state, actor.username, 'api.revoked_on_team_transfer', target.username, revokedScopes, null);
      }

      const profile = upsertProfile(state, target.username, {
        displayName: normalizeDisplayName(patch.displayName, target.displayName),
        role: nextRole,
        boundTo: nextBoundTo,
        monthlyTokenLimit: normalizeQuota(patch.monthlyTokenLimit, target.monthlyTokenLimit)
      });
      if (profile.role !== 'member' || !profile.boundTo) {
        state.grants = state.grants.filter(grant => !(grant.subject === target.username && grant.capability === API_CAPABILITY));
      }

      const after = getMemberUnsafe(state, target.username);
      appendAudit(state, actor.username, 'member.changed', target.username, {
        displayName: before.displayName,
        role: before.role,
        boundTo: before.boundTo,
        monthlyTokenLimit: before.monthlyTokenLimit
      }, {
        displayName: after.displayName,
        role: after.role,
        boundTo: after.boundTo,
        monthlyTokenLimit: after.monthlyTokenLimit
      });
      writeStateUnsafe(state);
      return after;
    });
  }

  function transferManagedMember(actorUsername, targetUsername, { boundTo, resetMonthlyTokenLimit = false } = {}) {
    return withLock(() => {
      const state = readStateUnsafe();
      const actor = ensureDev(state, actorUsername);
      const target = ensureActiveMember(state, targetUsername);
      if (target.role !== 'member') throw memberError('仅 MEMBER 可以转移团队');
      if (!boundTo) throw memberError('转移成员必须指定团队负责人');
      const owner = validateTeamOwnerBinding(state, boundTo, target.username);
      if (target.boundTo === owner.username) throw memberError('成员已属于该团队', 'CONFLICT');
      const before = clone(target);
      const clearedScopes = state.grants
        .filter(grant => grant.subject === target.username && grant.capability === API_CAPABILITY)
        .map(grant => grant.scope);
      state.grants = state.grants.filter(grant => !(grant.subject === target.username && grant.capability === API_CAPABILITY));
      upsertProfile(state, target.username, {
        boundTo: owner.username,
        monthlyTokenLimit: resetMonthlyTokenLimit ? null : target.monthlyTokenLimit
      });
      const member = getMemberUnsafe(state, target.username);
      appendAudit(state, actor.username, 'member.transferred', target.username, before, {
        boundTo: member.boundTo,
        clearedScopes,
        monthlyTokenLimit: member.monthlyTokenLimit
      });
      writeStateUnsafe(state);
      return { member, before, clearedScopes };
    });
  }

  function setApiAccess(actorUsername, targetUsername, enabled, scope = '*') {
    if (typeof enabled !== 'boolean') throw memberError('API 状态不合法');
    if (!API_SCOPES.has(scope)) throw memberError('API scope 不合法');
    return withLock(() => {
      const state = readStateUnsafe();
      const { actor, target } = ensureCanManageMember(state, actorUsername, targetUsername);
      if (target.role !== 'member') throw memberError('仅 MEMBER 使用团队 API 授权');
      if (enabled) validateTeamOwnerBinding(state, target.boundTo, target.username);

      const matching = state.grants.filter(grant => (
        grant.subject === target.username && grant.capability === API_CAPABILITY && grant.scope === scope
      ));
      if (enabled && matching.length === 0) {
        const grant = {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          actor: actor.username,
          subject: target.username,
          capability: API_CAPABILITY,
          scope
        };
        state.grants.push(grant);
        appendAudit(state, actor.username, 'api.enabled', target.username, null, grant);
      } else if (!enabled && matching.length) {
        state.grants = state.grants.filter(grant => !matching.some(item => item.id === grant.id));
        appendAudit(state, actor.username, 'api.disabled', target.username, matching, null);
      }
      writeStateUnsafe(state, ['grants', 'audit']);
      return getMemberUnsafe(state, target.username);
    });
  }

  function canUseApi(username, scope = 'text') {
    return withLock(() => {
      const state = readStateUnsafe();
      const member = getMemberUnsafe(state, username);
      if (!member || !member.active) return false;
      if (member.role === 'dev' || member.role === 'manager') return true;
      return state.grants.some(grant => grant.subject === username
        && grant.capability === API_CAPABILITY
        && (grant.scope === '*' || grant.scope === scope));
    });
  }

  function visibleTeamUnsafe(state, actorUsername) {
    const actor = ensureActiveMember(state, actorUsername);
    const all = accountStore.listAccounts().map(item => mergedMember(state, item));
    if (actor.role === 'dev') return all;
    if (actor.role === 'manager') {
      return all.filter(item => item.username === actor.username || (item.role === 'member' && item.boundTo === actor.username));
    }
    return [actor];
  }

  function visibleTeam(actorUsername) {
    return withLock(() => visibleTeamUnsafe(readStateUnsafe(), actorUsername));
  }

  function listAudit(actorUsername, limit = 100) {
    return withLock(() => {
      const state = readStateUnsafe();
      const actor = ensureActiveMember(state, actorUsername);
      const count = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 500);
      let entries = state.audit;
      if (actor.role === 'manager') {
        const subjects = new Set(visibleTeamUnsafe(state, actor.username).map(item => item.username));
        entries = entries.filter(entry => entry.actor === actor.username || subjects.has(entry.target));
      } else if (actor.role !== 'dev') {
        entries = entries.filter(entry => entry.target === actor.username || entry.actor === actor.username);
      }
      return entries.slice(-count).reverse().map(clone);
    });
  }

  return {
    files: { ...files },
    getMember,
    listMembers,
    visibleTeam,
    updateOwnProfile,
    createManagedMember,
    updateManagedMember,
    transferManagedMember,
    setApiAccess,
    canUseApi,
    listAudit,
    effectiveRole(username) {
      const member = getMember(username);
      return member?.role || null;
    }
  };
}

module.exports = { createMemberStore, ROLES, API_CAPABILITY, API_SCOPES };
