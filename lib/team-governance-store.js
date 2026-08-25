const path = require('node:path');
const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');

const DEFAULT_THRESHOLDS = [70, 90, 100];
const MAX_TEAM_TOKENS = 100_000_000_000;

function governanceError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeLimit(value, fallback = null) {
  if (value === undefined) return fallback;
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > MAX_TEAM_TOKENS) {
    throw governanceError('团队月度 Token 额度不合法');
  }
  return number;
}

function quotaState(used, limit) {
  const safeUsed = Math.max(0, Number(used) || 0);
  if (limit === null || limit === undefined) {
    return { used: safeUsed, limit: null, remaining: null, percent: null, level: 'unlimited', threshold: null };
  }
  const safeLimit = Math.max(0, Number(limit) || 0);
  const percent = safeLimit === 0 ? 100 : Math.min(100, Math.round((safeUsed / safeLimit) * 100));
  let level = 'normal';
  let threshold = null;
  if (percent >= 100) { level = 'exhausted'; threshold = 100; }
  else if (percent >= 90) { level = 'critical'; threshold = 90; }
  else if (percent >= 70) { level = 'warning'; threshold = 70; }
  return {
    used: safeUsed,
    limit: safeLimit,
    remaining: Math.max(0, safeLimit - safeUsed),
    percent,
    level,
    threshold
  };
}

function createTeamGovernanceStore({ systemDir } = {}) {
  if (!systemDir) throw new Error('systemDir is required');
  const filePath = path.join(systemDir, 'team-governance.json');
  const lockPath = path.join(systemDir, 'team-governance.lock');

  function readUnsafe() {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return [];
    if (!Array.isArray(result.value)) throw new Error('Invalid team governance store');
    return result.value;
  }

  function get(managerUsername) {
    return withJsonLock(lockPath, () => {
      const row = readUnsafe().find(item => item.managerUsername === managerUsername);
      return row ? { ...row, thresholds: [...DEFAULT_THRESHOLDS] } : {
        managerUsername,
        monthlyTokenLimit: null,
        thresholds: [...DEFAULT_THRESHOLDS],
        updatedAt: null,
        updatedBy: null
      };
    });
  }

  function update(managerUsername, patch = {}, actorUsername) {
    if (typeof managerUsername !== 'string' || !managerUsername) throw governanceError('MANAGER 账号不合法');
    return withJsonLock(lockPath, () => {
      const rows = readUnsafe();
      let row = rows.find(item => item.managerUsername === managerUsername);
      if (!row) {
        row = { managerUsername, monthlyTokenLimit: null, updatedAt: null, updatedBy: null };
        rows.push(row);
      }
      row.monthlyTokenLimit = normalizeLimit(patch.monthlyTokenLimit, row.monthlyTokenLimit);
      row.updatedAt = new Date().toISOString();
      row.updatedBy = actorUsername || managerUsername;
      writeJsonAtomic(filePath, rows);
      return { ...row, thresholds: [...DEFAULT_THRESHOLDS] };
    });
  }

  function list() {
    return withJsonLock(lockPath, () => readUnsafe().map(item => ({ ...item, thresholds: [...DEFAULT_THRESHOLDS] })));
  }

  return { filePath, get, update, list };
}

function governanceStoreForMemberStore(memberStore) {
  const auditPath = memberStore?.files?.audit;
  if (!auditPath) throw new Error('memberStore audit path is required');
  return createTeamGovernanceStore({ systemDir: path.dirname(auditPath) });
}

module.exports = {
  DEFAULT_THRESHOLDS,
  createTeamGovernanceStore,
  governanceStoreForMemberStore,
  quotaState,
  normalizeLimit
};
