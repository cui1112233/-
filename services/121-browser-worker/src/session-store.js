const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizeIdentity(identity = {}) {
  const owner = String(identity.owner || '').trim();
  const username = String(identity.username || '').trim();
  const url = new URL(String(identity.baseUrl || '').trim());
  if (!owner || !username || !['http:', 'https:'].includes(url.protocol)) throw new Error('invalid session identity');
  return { owner, username, host: url.host.toLowerCase() };
}

function deriveSessionKey(identity) {
  const normalized = normalizeIdentity(identity);
  return crypto.createHash('sha256')
    .update(`${normalized.owner}\n${normalized.host}\n${normalized.username}`)
    .digest('hex').slice(0, 40);
}

function createSessionStore({ rootDir, legacyRootDir = '', clock = () => new Date() } = {}) {
  if (!rootDir) throw new Error('rootDir is required');
  const root = path.resolve(rootDir);
  const legacyRoot = String(legacyRootDir || '').trim() ? path.resolve(String(legacyRootDir)) : '';

  function pathFor(identity) { return path.join(root, `${deriveSessionKey(identity)}.json`); }
  function legacyPathFor(identity) { return legacyRoot ? path.join(legacyRoot, `${deriveSessionKey(identity)}.json`) : ''; }
  function save(identity, storageState) {
    const file = pathFor(identity);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(storageState || {}, null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(temp, 0o600); } catch (_) {}
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch (_) {}
    return { sessionKey: deriveSessionKey(identity), path: file };
  }
  function load(identity) {
    const file = pathFor(identity);
    if (!fs.existsSync(file)) {
      // The public runtime previously ran a second browser worker with its
      // own named volume. On first access, adopt only the same owner/host/
      // target-user key from that retired volume and persist it in the active
      // volume. This is a one-way migration; the legacy volume remains intact.
      const legacyFile = legacyPathFor(identity);
      if (!legacyFile || !fs.existsSync(legacyFile)) return null;
      try {
        const state = JSON.parse(fs.readFileSync(legacyFile, 'utf8'));
        if (!state || typeof state !== 'object') return null;
        save(identity, state);
        return state;
      } catch (_) { return null; }
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      const stamp = clock().toISOString().replace(/[:.]/g, '-');
      const bad = `${file}.bad-${stamp}`;
      try { fs.renameSync(file, bad); } catch (_) {}
      return null;
    }
  }
  function remove(identity) {
    const file = pathFor(identity);
    try { fs.unlinkSync(file); return true; }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  }
  return { pathFor, save, load, remove };
}

module.exports = { deriveSessionKey, createSessionStore };
