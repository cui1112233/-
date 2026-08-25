const crypto = require('node:crypto');
const path = require('node:path');

const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');

const INVITE_SCOPES = new Set(['text', 'image', 'tts']);
const MAX_INVITE_HOURS = 24 * 30;
const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

function collaborationError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function digestToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function normalizeTeamName(value, fallback = '未命名团队') {
  const text = String(value || fallback).trim();
  if (!text || text.length > 60) throw collaborationError('团队名称需为 1-60 个字符');
  return text;
}

function normalizeInviteScopes(value) {
  const scopes = Array.isArray(value) ? [...new Set(value)] : [];
  if (scopes.some(scope => !INVITE_SCOPES.has(scope))) throw collaborationError('邀请 API scopes 不合法');
  return scopes;
}

function normalizeQuota(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 10_000_000_000) throw collaborationError('成员月度 Token 额度不合法');
  return number;
}

function normalizeCoManagers(value, primaryManager) {
  const usernames = Array.isArray(value) ? [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))] : [];
  if (usernames.some(item => !USERNAME_PATTERN.test(item))) throw collaborationError('联合管理员账号不合法');
  return usernames.filter(item => item !== primaryManager).slice(0, 20);
}

function publicTeam(team) {
  if (!team) return null;
  return { ...team, coManagers: normalizeCoManagers(team.coManagers, team.managerUsername) };
}

function createTeamCollaborationStore({ systemDir } = {}) {
  if (!systemDir) throw new Error('systemDir is required');
  const filePath = path.join(systemDir, 'team-collaboration.json');
  const lockPath = path.join(systemDir, 'team-collaboration.lock');

  function emptyState() { return { teams: [], invites: [], notifications: [], archives: [] }; }

  function readUnsafe() {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return emptyState();
    const state = result.value;
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid team collaboration store');
    const teams = Array.isArray(state.teams) ? state.teams : [];
    for (const team of teams) team.coManagers = normalizeCoManagers(team.coManagers, team.managerUsername);
    return {
      teams,
      invites: Array.isArray(state.invites) ? state.invites : [],
      notifications: Array.isArray(state.notifications) ? state.notifications : [],
      archives: Array.isArray(state.archives) ? state.archives : []
    };
  }

  function writeUnsafe(state) { writeJsonAtomic(filePath, state); }

  function ensureTeam(managerUsername, displayName) {
    if (!managerUsername) throw collaborationError('MANAGER 账号不能为空');
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      let team = state.teams.find(item => item.managerUsername === managerUsername);
      if (!team) {
        const now = new Date().toISOString();
        team = {
          id: crypto.randomUUID(),
          name: normalizeTeamName(displayName ? `${displayName}的团队` : `${managerUsername}的团队`),
          managerUsername,
          coManagers: [],
          createdAt: now,
          updatedAt: now
        };
        state.teams.push(team);
        writeUnsafe(state);
      }
      return publicTeam(team);
    });
  }

  function getTeamByManager(managerUsername) {
    return withJsonLock(lockPath, () => publicTeam(readUnsafe().teams.find(item => item.managerUsername === managerUsername)));
  }

  function getTeam(teamId) {
    return withJsonLock(lockPath, () => publicTeam(readUnsafe().teams.find(item => item.id === teamId)));
  }

  function listTeams() {
    return withJsonLock(lockPath, () => readUnsafe().teams.map(publicTeam));
  }

  function teamsForManager(username) {
    return withJsonLock(lockPath, () => readUnsafe().teams
      .filter(item => item.managerUsername === username || item.coManagers?.includes(username))
      .map(publicTeam));
  }

  function canManageTeam(teamId, username) {
    return withJsonLock(lockPath, () => {
      const team = readUnsafe().teams.find(item => item.id === teamId);
      return Boolean(team && (team.managerUsername === username || team.coManagers?.includes(username)));
    });
  }

  function renameTeam(teamId, name) {
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const team = state.teams.find(item => item.id === teamId);
      if (!team) throw collaborationError('团队不存在', 'NOT_FOUND');
      team.name = normalizeTeamName(name, team.name);
      team.updatedAt = new Date().toISOString();
      writeUnsafe(state);
      return publicTeam(team);
    });
  }

  function setCoManagers(teamId, usernames) {
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const team = state.teams.find(item => item.id === teamId);
      if (!team) throw collaborationError('团队不存在', 'NOT_FOUND');
      team.coManagers = normalizeCoManagers(usernames, team.managerUsername);
      team.updatedAt = new Date().toISOString();
      writeUnsafe(state);
      return publicTeam(team);
    });
  }

  function createInvite({ teamId, managerUsername, createdBy, expiresInHours = 72, monthlyTokenLimit = null, apiScopes = [] } = {}) {
    const hours = Number(expiresInHours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > MAX_INVITE_HOURS) throw collaborationError('邀请有效期不合法');
    const scopes = normalizeInviteScopes(apiScopes);
    const quota = normalizeQuota(monthlyTokenLimit);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const team = state.teams.find(item => item.id === teamId && item.managerUsername === managerUsername);
      if (!team) throw collaborationError('团队不存在', 'NOT_FOUND');
      const token = crypto.randomBytes(24).toString('base64url');
      const now = Date.now();
      const invite = {
        id: crypto.randomUUID(), tokenDigest: digestToken(token), teamId, managerUsername, createdBy,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + Math.round(hours * 60 * 60 * 1000)).toISOString(),
        monthlyTokenLimit: quota, apiScopes: scopes, usedAt: null, usedBy: null
      };
      state.invites.push(invite);
      writeUnsafe(state);
      return { token, invite: { ...invite, tokenDigest: undefined, teamName: team.name } };
    });
  }

  function inviteView(state, invite) {
    if (!invite) return null;
    const team = state.teams.find(item => item.id === invite.teamId);
    return {
      id: invite.id, teamId: invite.teamId, teamName: team?.name || '团队', managerUsername: invite.managerUsername,
      createdAt: invite.createdAt, expiresAt: invite.expiresAt, monthlyTokenLimit: invite.monthlyTokenLimit,
      apiScopes: [...(invite.apiScopes || [])], usedAt: invite.usedAt, usedBy: invite.usedBy,
      expired: Date.parse(invite.expiresAt) <= Date.now(), available: !invite.usedAt && Date.parse(invite.expiresAt) > Date.now()
    };
  }

  function inspectInvite(token) {
    const digest = digestToken(token);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      return inviteView(state, state.invites.find(item => item.tokenDigest === digest));
    });
  }

  function claimInvite(token, username) {
    const digest = digestToken(token);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const invite = state.invites.find(item => item.tokenDigest === digest);
      if (!invite) throw collaborationError('邀请不存在', 'NOT_FOUND');
      if (invite.usedAt) throw collaborationError('邀请已被使用', 'CONFLICT');
      if (Date.parse(invite.expiresAt) <= Date.now()) throw collaborationError('邀请已过期', 'CONFLICT');
      invite.usedAt = new Date().toISOString();
      invite.usedBy = username;
      writeUnsafe(state);
      return inviteView(state, invite);
    });
  }

  function releaseInviteClaim(token, username) {
    const digest = digestToken(token);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const invite = state.invites.find(item => item.tokenDigest === digest);
      if (!invite || invite.usedBy !== username) return false;
      invite.usedAt = null;
      invite.usedBy = null;
      writeUnsafe(state);
      return true;
    });
  }

  function listInvitesForManager(managerUsername) {
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      return state.invites.filter(item => item.managerUsername === managerUsername)
        .map(item => inviteView(state, item)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    });
  }

  function notify(username, { type = 'info', title, message, metadata = null } = {}) {
    if (!username || !title) return null;
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const entry = {
        id: crypto.randomUUID(), username, type, title: String(title).slice(0, 100),
        message: String(message || '').slice(0, 500), metadata: metadata && typeof metadata === 'object' ? metadata : null,
        createdAt: new Date().toISOString(), readAt: null
      };
      state.notifications.push(entry);
      if (state.notifications.length > 5000) state.notifications.splice(0, state.notifications.length - 5000);
      writeUnsafe(state);
      return { ...entry };
    });
  }

  function listNotifications(username, limit = 50) {
    const count = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 5000);
    return withJsonLock(lockPath, () => readUnsafe().notifications.filter(item => item.username === username)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, count).map(item => ({ ...item })));
  }

  function countUnread(username) {
    return withJsonLock(lockPath, () => readUnsafe().notifications.filter(item => item.username === username && !item.readAt).length);
  }

  function markNotificationRead(username, id) {
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const entry = state.notifications.find(item => item.id === id && item.username === username);
      if (!entry) throw collaborationError('通知不存在', 'NOT_FOUND');
      if (!entry.readAt) entry.readAt = new Date().toISOString();
      writeUnsafe(state);
      return { ...entry };
    });
  }

  function markAllNotificationsRead(username) {
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const now = new Date().toISOString();
      let changed = 0;
      for (const entry of state.notifications) {
        if (entry.username === username && !entry.readAt) { entry.readAt = now; changed += 1; }
      }
      if (changed) writeUnsafe(state);
      return changed;
    });
  }

  function archiveMember(username, archivedBy, reason = '') {
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      let entry = state.archives.find(item => item.username === username && !item.restoredAt);
      if (!entry) {
        entry = { username, archivedAt: new Date().toISOString(), archivedBy, reason: String(reason || '').trim().slice(0, 300), restoredAt: null, restoredBy: null };
        state.archives.push(entry);
        writeUnsafe(state);
      }
      return { ...entry };
    });
  }

  function restoreMember(username, restoredBy) {
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const entry = [...state.archives].reverse().find(item => item.username === username && !item.restoredAt);
      if (!entry) return null;
      entry.restoredAt = new Date().toISOString();
      entry.restoredBy = restoredBy;
      writeUnsafe(state);
      return { ...entry };
    });
  }

  function getArchive(username) {
    return withJsonLock(lockPath, () => {
      const entry = [...readUnsafe().archives].reverse().find(item => item.username === username && !item.restoredAt);
      return entry ? { ...entry } : null;
    });
  }

  return {
    filePath, ensureTeam, getTeamByManager, getTeam, listTeams, teamsForManager, canManageTeam, renameTeam, setCoManagers,
    createInvite, inspectInvite, claimInvite, releaseInviteClaim, listInvitesForManager,
    notify, listNotifications, countUnread, markNotificationRead, markAllNotificationsRead,
    archiveMember, restoreMember, getArchive
  };
}

module.exports = { createTeamCollaborationStore, collaborationError, INVITE_SCOPES };
