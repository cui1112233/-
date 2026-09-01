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

function deriveEncryptionKey(secret) {
  const value = String(secret || '').trim();
  if (!value) throw new Error('121 storage encryption secret is required');
  return crypto.createHash('sha256').update(value).digest();
}

function createSessionStore({ rootDir, secret, clock = () => new Date() } = {}) {
  if (!rootDir) throw new Error('rootDir is required');
  const root = path.resolve(rootDir);
  const encryptionKey = deriveEncryptionKey(secret);

  function pathFor(identity) { return path.join(root, `${deriveSessionKey(identity)}.json`); }
  function quarantine(file) {
    const stamp = clock().toISOString().replace(/[:.]/g, '-');
    const bad = `${file}.bad-${stamp}`;
    try { fs.renameSync(file, bad); } catch (_) {}
  }
  function save(identity, storageState) {
    const sessionKey = deriveSessionKey(identity);
    const file = pathFor(identity);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(Buffer.from(sessionKey, 'utf8'));
    const plaintext = Buffer.from(JSON.stringify(storageState || {}), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope = {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(temp, 0o600); } catch (_) {}
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch (_) {}
    return { sessionKey, path: file };
  }
  function load(identity) {
    const file = pathFor(identity);
    if (!fs.existsSync(file)) return null;
    try {
      const envelope = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'aes-256-gcm') throw new Error('invalid encrypted storage state');
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, Buffer.from(String(envelope.iv || ''), 'base64'));
      decipher.setAAD(Buffer.from(deriveSessionKey(identity), 'utf8'));
      decipher.setAuthTag(Buffer.from(String(envelope.tag || ''), 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(String(envelope.ciphertext || ''), 'base64')),
        decipher.final()
      ]).toString('utf8');
      const parsed = JSON.parse(plaintext);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      quarantine(file);
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

module.exports = { deriveSessionKey, deriveEncryptionKey, createSessionStore };
