const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  readJsonOrMissing,
  withJsonLock,
  writeJsonAtomic
} = require('../system-store');
const {
  assertValidUsername,
  cloneJsonSafe,
  isPlainObject
} = require('./contracts');

const HISTORY_SCHEMA = 'v77_history_v1';
const HISTORY_ID_PREFIX = 'hist_';
const HISTORY_ID_PATTERN = /^hist_[A-Za-z0-9_-]{1,80}$/;
const MAX_NOTE_LENGTH = 4000;
const MAX_SOURCE_PREVIEW_LENGTH = 60;

function isValidHistoryId(id) {
  return typeof id === 'string' && HISTORY_ID_PATTERN.test(id);
}

function assertValidHistoryId(id) {
  if (!isValidHistoryId(id)) throw new Error('Invalid history id');
  return id;
}

function newHistoryId(now = new Date()) {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('');
  const clock = [
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ].join('');
  const suffix = crypto.randomBytes(4).toString('hex');
  return `${HISTORY_ID_PREFIX}${stamp}_${clock}_${suffix}`;
}

function text(value, limit = 0) {
  const result = String(value == null ? '' : value).trim();
  return limit ? result.slice(0, limit) : result;
}

function historySummary(workspace) {
  const source = isPlainObject(workspace) ? workspace : {};
  const preview = text(String(source.novel_text ?? source.novelText ?? '').replace(/\s+/g, ' '), MAX_SOURCE_PREVIEW_LENGTH);

  const characterCore = isPlainObject(source.character_core_v2) ? source.character_core_v2 : null;
  const slots = Array.isArray(characterCore?.slots) ? characterCore.slots : null;
  const characters = Array.isArray(slots) ? slots
    : Array.isArray(source.characters) ? source.characters
      : [];
  const scenes = Array.isArray(source.scenes) ? source.scenes : [];
  const shots = Array.isArray(source.outline_shots) ? source.outline_shots : [];

  let duration = 0;
  for (const shot of shots) {
    if (!isPlainObject(shot)) continue;
    const value = Number(shot.duration);
    if (Number.isFinite(value)) duration += value;
  }

  return {
    source_preview: preview,
    character_count: characters.length,
    scene_count: scenes.length,
    shot_count: shots.length,
    duration: Math.round(duration * 100) / 100
  };
}

function normalizeHistoryRecord(record) {
  if (!isPlainObject(record)) throw new Error('Invalid history record');
  const source = cloneJsonSafe(record);
  const historyId = text(source.history_id);
  assertValidHistoryId(historyId);
  const workspace = isPlainObject(source.workspace) ? source.workspace : {};
  return {
    schema: HISTORY_SCHEMA,
    history_id: historyId,
    note: text(source.note, MAX_NOTE_LENGTH),
    created_at: text(source.created_at),
    updated_at: text(source.updated_at),
    ...(source.note_updated_at === undefined ? {} : { note_updated_at: text(source.note_updated_at) }),
    summary: historySummary(workspace),
    ...(source.instruction_revision === undefined ? {} : { instruction_revision: cloneJsonSafe(source.instruction_revision) }),
    workspace
  };
}

function readHistoryFile(filePath, expectedId) {
  let result;
  try {
    result = readJsonOrMissing(filePath);
  } catch {
    throw new Error('Invalid history store');
  }
  if (!result.found) return null;
  try {
    const record = normalizeHistoryRecord(result.value);
    if (record.history_id !== expectedId) throw new Error('History id mismatch');
    return record;
  } catch {
    throw new Error('Invalid history store');
  }
}

function createNovelPanelHistoryStore({ usersDir } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const resolvedUsersDir = path.resolve(usersDir);

  function historyDir(username) {
    const user = assertValidUsername(username);
    return path.join(resolvedUsersDir, user, 'novel-panel', 'history');
  }

  function historyPath(username, id) {
    assertValidUsername(username);
    assertValidHistoryId(id);
    return path.join(historyDir(username), `${id}.json`);
  }

  function lockPath(username) {
    const user = assertValidUsername(username);
    return path.join(resolvedUsersDir, user, 'novel-panel', 'history.lock');
  }

  function withHistoryLock(username, operation) {
    const user = assertValidUsername(username);
    return withJsonLock(lockPath(user), () => operation(user));
  }

  function writeRecordUnlocked(username, record) {
    const normalized = normalizeHistoryRecord(record);
    writeJsonAtomic(historyPath(username, normalized.history_id), normalized);
    return cloneJsonSafe(normalized);
  }

  function listHistory(username, limit = 50) {
    const user = assertValidUsername(username);
    const directory = historyDir(user);
    const effectiveLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50;
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw error;
    }
    const records = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -'.json'.length);
      if (!isValidHistoryId(id)) continue;
      const record = readHistoryFile(historyPath(user, id), id);
      if (!record) continue;
      records.push({
        history_id: record.history_id,
        note: record.note,
        created_at: record.created_at,
        updated_at: record.updated_at,
        summary: cloneJsonSafe(record.summary),
        instruction_revision: record.instruction_revision === undefined ? undefined : cloneJsonSafe(record.instruction_revision)
      });
    }
    return records
      .sort((left, right) => {
        const timeDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
        if (Number.isFinite(timeDifference) && timeDifference !== 0) return timeDifference;
        return left.history_id.localeCompare(right.history_id);
      })
      .slice(0, effectiveLimit)
      .map(record => {
        if (record.instruction_revision === undefined) delete record.instruction_revision;
        return record;
      });
  }

  function readHistory(username, id) {
    const user = assertValidUsername(username);
    assertValidHistoryId(id);
    const record = readHistoryFile(historyPath(user, id), id);
    return record === null ? null : cloneJsonSafe(record);
  }

  function createHistory(username, { note, workspace, instruction_revision } = {}) {
    const user = assertValidUsername(username);
    if (!isPlainObject(workspace)) throw new Error('Invalid history workspace');
    return withHistoryLock(user, lockedUser => {
      const now = new Date().toISOString();
      const record = {
        schema: HISTORY_SCHEMA,
        history_id: newHistoryId(),
        note: text(note, MAX_NOTE_LENGTH),
        created_at: now,
        updated_at: now,
        summary: historySummary(workspace),
        ...(instruction_revision === undefined ? {} : { instruction_revision: cloneJsonSafe(instruction_revision) }),
        workspace: cloneJsonSafe(workspace)
      };
      return writeRecordUnlocked(lockedUser, record);
    });
  }

  function overwriteHistory(username, id, { note, workspace, instruction_revision } = {}) {
    const user = assertValidUsername(username);
    assertValidHistoryId(id);
    if (!isPlainObject(workspace)) throw new Error('Invalid history workspace');
    return withHistoryLock(user, lockedUser => {
      const existing = readHistoryFile(historyPath(lockedUser, id), id);
      if (!existing) return null;
      const record = {
        ...existing,
        note: text(note, MAX_NOTE_LENGTH),
        updated_at: new Date().toISOString(),
        summary: historySummary(workspace),
        ...(instruction_revision === undefined ? {} : { instruction_revision: cloneJsonSafe(instruction_revision) }),
        workspace: cloneJsonSafe(workspace)
      };
      return writeRecordUnlocked(lockedUser, record);
    });
  }

  function updateHistoryNote(username, id, note) {
    const user = assertValidUsername(username);
    assertValidHistoryId(id);
    return withHistoryLock(user, lockedUser => {
      const existing = readHistoryFile(historyPath(lockedUser, id), id);
      if (!existing) return null;
      const record = {
        ...existing,
        note: text(note, MAX_NOTE_LENGTH),
        note_updated_at: new Date().toISOString()
      };
      return writeRecordUnlocked(lockedUser, record);
    });
  }

  function deleteHistory(username, id) {
    const user = assertValidUsername(username);
    return withHistoryLock(user, lockedUser => {
      assertValidHistoryId(id);
      try {
        fs.unlinkSync(historyPath(lockedUser, id));
        return true;
      } catch (error) {
        if (error && error.code === 'ENOENT') return false;
        throw error;
      }
    });
  }

  return {
    createHistory,
    deleteHistory,
    historyDir,
    listHistory,
    overwriteHistory,
    readHistory,
    updateHistoryNote
  };
}

module.exports = {
  HISTORY_ID_PATTERN,
  HISTORY_SCHEMA,
  createNovelPanelHistoryStore,
  historySummary,
  isValidHistoryId,
  newHistoryId
};
