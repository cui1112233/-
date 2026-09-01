const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeBaseUrl, requireStrongSecret } = require('./contracts');

function normalizeIdentity(identity = {}) {
  const owner = String(identity.owner || '').trim();
  const username = String(identity.username || '').trim();
  const url = new URL(normalizeBaseUrl(identity.baseUrl));
  if (!owner || !username) throw new Error('invalid session identity');
  return { owner, username, host: url.hostname.toLowerCase() };
}

function deriveSessionKey(identity) {
  const normalized = normalizeIdentity(identity);
  return crypto.createHash('sha256')
    .update(`${normalized.owner}\n${normalized.host}\n${normalized.username}`)
    .digest('hex').slice(0, 40);
}

function createSessionStore({
  rootDir,
  secret = process.env.QIANTIE_121_STORAGE_STATE_SECRET,
  clock = () => new Date()
} = {}) {
  if (!rootDir) throw new Error('rootDir is required');
  const secretText = requireStrongSecret(secret, '121 storage state secret');
  const root = path.resolve(rootDir);
  const key = crypto.createHash('sha256').update(secretText).digest();

  function pathFor(identity) { return path.join(root, `${deriveSessionKey(identity)}.json`); }

  function encrypt(storageState) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify(storageState || {}), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64')
    };
  }

  function decrypt(record) {
    if (!record || record.version !== 1 || record.algorithm !== 'aes-256-gcm') throw new Error('unsupported storage state envelope');
    const iv = Buffer.from(String(record.iv || ''), 'base64');
    const tag = Buffer.from(String(record.tag || ''), 'base64');
    const ciphertext = Buffer.from(String(record.ciphertext || ''), 'base64');
    if (iv.length !== 12 || tag.length !== 16 || ciphertext.length < 1) throw new Error('invalid storage state envelope');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(plaintext);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid storage state payload');
    return parsed;
  }

  function quarantine(file) {
    const stamp = clock().toISOString().replace(/[:.]/g, '-');
    const bad = `${file}.bad-${stamp}`;
    try { fs.renameSync(file, bad); } catch (_) {}
  }

  function save(identity, storageState) {
    const file = pathFor(identity);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(encrypt(storageState), null, 2), { encoding: 'utf8', mode: 0o600 });
    try { fs.chmodSync(temp, 0o600); } catch (_) {}
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch (_) {}
    return { sessionKey: deriveSessionKey(identity), path: file };
  }

  function load(identity) {
    const file = pathFor(identity);
    if (!fs.existsSync(file)) return null;
    try {
      const record = JSON.parse(fs.readFileSync(file, 'utf8'));
      return decrypt(record);
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

module.exports = { deriveSessionKey, createSessionStore };
