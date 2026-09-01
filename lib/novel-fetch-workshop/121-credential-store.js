const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { assertValidUsername } = require('../novel-panel/contracts');
const { readJsonOrMissing, writeJsonAtomic } = require('../system-store');

function create121CredentialStore({ usersDir, secret } = {}) {
  if (typeof usersDir !== 'string' || !usersDir.trim()) throw new Error('usersDir is required');
  const secretText = String(secret || '').trim();
  if (!secretText) throw new Error('121 credential secret is required');
  const root = path.resolve(usersDir);
  const key = crypto.createHash('sha256').update(secretText).digest();

  function file(owner) {
    assertValidUsername(owner);
    return path.join(root, owner, 'novel-fetch-workshop', '121-credentials.json');
  }

  function set(owner, credentials = {}) {
    const targetUsername = String(credentials.targetUsername || '').trim();
    const password = String(credentials.password || '');
    const baseUrl = String(credentials.baseUrl || '').trim();
    if (!targetUsername || !password || !baseUrl) throw new Error('121 credentials are incomplete');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const plaintext = Buffer.from(JSON.stringify({ targetUsername, password, baseUrl }), 'utf8');
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const record = {
      version: 1,
      algorithm: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
      updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(path.dirname(file(owner)), { recursive: true });
    writeJsonAtomic(file(owner), record);
    return { saved: true, updatedAt: record.updatedAt };
  }

  function get(owner) {
    const result = readJsonOrMissing(file(owner));
    if (!result.found || !result.value || result.value.version !== 1) return null;
    try {
      const record = result.value;
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(record.iv || ''), 'base64'));
      decipher.setAuthTag(Buffer.from(String(record.tag || ''), 'base64'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(String(record.ciphertext || ''), 'base64')),
        decipher.final()
      ]).toString('utf8');
      const value = JSON.parse(plaintext);
      if (!value?.targetUsername || !value?.password || !value?.baseUrl) return null;
      return { targetUsername: String(value.targetUsername), password: String(value.password), baseUrl: String(value.baseUrl) };
    } catch (_) {
      return null;
    }
  }

  function clear(owner) {
    const target = file(owner);
    try { fs.unlinkSync(target); return true; }
    catch (error) { if (error?.code === 'ENOENT') return false; throw error; }
  }

  return { set, get, clear };
}

module.exports = { create121CredentialStore };
