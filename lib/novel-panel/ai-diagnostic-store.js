const crypto = require('node:crypto');
const path = require('node:path');

const { readJsonOrMissing, withJsonLock, writeJsonAtomic } = require('../system-store');
const { assertValidUsername, isPlainObject } = require('./contracts');

const DEFAULT_MAX_ENTRIES = 100;
const DEFAULT_LIST_LIMIT = 50;
const MAX_ENTRIES_LIMIT = 100;
const MAX_STRING_LENGTH = 500;
const STRING_FIELDS = new Set([
  'operation', 'model', 'base_url_host', 'outcome', 'category', 'error', 'gate_summary'
]);
const NUMBER_FIELDS = new Set([
  'timeout_seconds', 'request_chars', 'system_chars', 'max_tokens', 'http_status', 'elapsed_ms',
  'outline_returned', 'outline_accepted', 'outline_rejected'
]);

function clampPositiveInteger(value, fallback, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0) return fallback;
  return Math.min(value, maximum);
}

function redact(value) {
  return String(value)
    .replace(/((?:["']?)(?:authorization|api[_-]?key|apikey|novel_text|prompt)(?:["']?)\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^,，;；\n\r&}]+)/gi, '$1[REDACTED]')
    .replace(/\bauthorization\s*[:=]?\s*bearer\s+[^\s,;]+/gi, '[REDACTED]')
    .replace(/\bbearer\s+[^\s,;]+/gi, '[REDACTED]')
    .replace(/\bapi[_-]?key\s*[:=]\s*[^\s,;]+/gi, '[REDACTED]')
    .replace(/\bnovel_text\s*[:=]\s*[^,，;；\n\r&}]*?(?=\s*[,，;；\n\r&}]|$)/gi, '[REDACTED]')
    .replace(/\bsk-[a-z0-9_-]+/gi, '[REDACTED]')
    .slice(0, MAX_STRING_LENGTH);
}

function safeString(value) {
  return typeof value === 'string' ? redact(value) : undefined;
}

function safeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function normalizeDiagnostic(event) {
  const source = isPlainObject(event) ? event : {};
  const entry = {
    id: crypto.randomUUID(),
    at: new Date().toISOString()
  };

  for (const field of STRING_FIELDS) {
    const value = safeString(source[field]);
    if (value !== undefined) entry[field] = value;
  }
  for (const field of NUMBER_FIELDS) {
    const value = safeNonNegativeInteger(source[field]);
    if (value !== undefined) entry[field] = value;
  }
  if (typeof source.partial === 'boolean') entry.partial = source.partial;
  return entry;
}

function cloneEntry(entry) {
  return { ...entry };
}

function createNovelPanelAiDiagnosticStore({ usersDir, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const resolvedUsersDir = path.resolve(usersDir);
  const effectiveMaxEntries = clampPositiveInteger(maxEntries, DEFAULT_MAX_ENTRIES, MAX_ENTRIES_LIMIT);

  function filePath(username) {
    assertValidUsername(username);
    return path.join(resolvedUsersDir, username, 'novel-panel', 'ai-diagnostics.json');
  }

  function read(username) {
    let result;
    try {
      result = readJsonOrMissing(filePath(username));
    } catch {
      return [];
    }
    if (!result.found || !Array.isArray(result.value)) return [];
    return result.value.filter(isPlainObject).map(cloneEntry).slice(0, effectiveMaxEntries);
  }

  function write(username, entries) {
    writeJsonAtomic(filePath(username), entries.slice(0, effectiveMaxEntries));
  }

  return {
    record(username, event = {}) {
      const entry = normalizeDiagnostic(event);
      const targetPath = filePath(username);
      withJsonLock(`${targetPath}.lock`, () => {
        write(username, [entry, ...read(username)]);
      });
      return cloneEntry(entry);
    },

    listForUser(username, limit = DEFAULT_LIST_LIMIT) {
      const effectiveLimit = clampPositiveInteger(limit, DEFAULT_LIST_LIMIT, effectiveMaxEntries);
      return read(username).slice(0, effectiveLimit).map(cloneEntry);
    }
  };
}

module.exports = { createNovelPanelAiDiagnosticStore, redact };
