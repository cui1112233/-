const fs = require('fs');
const path = require('path');

const MAX_ENTRIES = 500;
const MAX_TEXT_LENGTH = 4000;

function redact(value) {
  return String(value || '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(password\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(sk-[a-z0-9_-]{8,})/gi, '[REDACTED_API_KEY]')
    .slice(0, MAX_TEXT_LENGTH);
}

function normalizeEvent(event = {}) {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    kind: redact(event.kind || 'server.unknown'),
    message: redact(event.message || 'Unknown error'),
    stack: redact(event.stack || ''),
    path: redact(event.path || ''),
    method: redact(event.method || ''),
    status: Number.isInteger(event.status) ? event.status : undefined,
    username: redact(event.username || ''),
    source: redact(event.source || ''),
    context: redact(event.context || '')
  };
}

function createErrorLogStore({ filePath } = {}) {
  const resolvedPath = filePath || path.join(__dirname, '..', 'data', 'system', 'error-logs.json');

  function read() {
    try {
      const saved = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      return Array.isArray(saved) ? saved : [];
    } catch (_) {
      return [];
    }
  }

  function write(entries) {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify(entries.slice(0, MAX_ENTRIES), null, 2), 'utf8');
  }

  return {
    record(event) {
      const entry = normalizeEvent(event);
      write([entry, ...read()]);
      return entry;
    },
    list(limit = 100) {
      return read().slice(0, Math.max(1, Math.min(MAX_ENTRIES, Number(limit) || 100)));
    },
    listForUser(username, limit = 100) {
      const user = String(username || '');
      return this.list(limit).filter(entry => entry.username === user);
    }
  };
}

module.exports = { createErrorLogStore, redact };
