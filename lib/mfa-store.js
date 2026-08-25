const crypto = require('node:crypto');
const path = require('node:path');

const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_DIGITS = 6;

function mfaError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(text) {
  const clean = String(text || '').replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const character of clean) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) throw new Error('Invalid base32 secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function hotp(secret, counter) {
  const key = base32Decode(secret);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', key).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % (10 ** TOTP_DIGITS)).padStart(TOTP_DIGITS, '0');
}

function verifyTotp(secret, code, now = Date.now()) {
  const normalized = String(code || '').trim();
  if (!/^\d{6}$/.test(normalized)) return false;
  const counter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
  for (let drift = -1; drift <= 1; drift += 1) {
    if (hotp(secret, counter + drift) === normalized) return true;
  }
  return false;
}

function normalizeRecoveryCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function hashRecoveryCode(value) {
  return crypto.createHash('sha256').update(normalizeRecoveryCode(value)).digest('hex');
}

function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;
  });
}

function createMfaStore({ systemDir } = {}) {
  if (!systemDir) throw new Error('systemDir is required');
  const filePath = path.join(systemDir, 'mfa.json');
  const lockPath = path.join(systemDir, 'mfa.lock');

  function readUnsafe() {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return [];
    if (!Array.isArray(result.value)) throw new Error('Invalid MFA store');
    return result.value;
  }

  function status(username) {
    return withJsonLock(lockPath, () => {
      const row = readUnsafe().find(item => item.username === username);
      return {
        enabled: Boolean(row?.enabled && row.secret),
        enabledAt: row?.enabledAt || null,
        recoveryCodesRemaining: Array.isArray(row?.recoveryHashes) ? row.recoveryHashes.length : 0,
        setupPending: Boolean(row?.pendingSecret)
      };
    });
  }

  function beginSetup(username, { issuer = '一战晟铭', accountLabel = username } = {}) {
    return withJsonLock(lockPath, () => {
      const rows = readUnsafe();
      let row = rows.find(item => item.username === username);
      if (!row) {
        row = { username, enabled: false, secret: null, enabledAt: null, recoveryHashes: [], pendingSecret: null, pendingAt: null };
        rows.push(row);
      }
      const secret = base32Encode(crypto.randomBytes(20));
      row.pendingSecret = secret;
      row.pendingAt = new Date().toISOString();
      writeJsonAtomic(filePath, rows);
      const label = encodeURIComponent(`${issuer}:${accountLabel}`);
      const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;
      return { secret, otpauthUri: uri };
    });
  }

  function enable(username, code) {
    return withJsonLock(lockPath, () => {
      const rows = readUnsafe();
      const row = rows.find(item => item.username === username);
      if (!row?.pendingSecret) throw mfaError('请先开始 MFA 设置', 'MFA_SETUP_REQUIRED');
      if (!verifyTotp(row.pendingSecret, code)) throw mfaError('动态验证码不正确', 'MFA_CODE_INVALID');
      const recoveryCodes = generateRecoveryCodes();
      row.secret = row.pendingSecret;
      row.pendingSecret = null;
      row.pendingAt = null;
      row.enabled = true;
      row.enabledAt = new Date().toISOString();
      row.recoveryHashes = recoveryCodes.map(hashRecoveryCode);
      writeJsonAtomic(filePath, rows);
      return { status: { enabled: true, enabledAt: row.enabledAt, recoveryCodesRemaining: recoveryCodes.length, setupPending: false }, recoveryCodes };
    });
  }

  function verify(username, code, now = Date.now()) {
    return withJsonLock(lockPath, () => {
      const rows = readUnsafe();
      const row = rows.find(item => item.username === username);
      if (!row?.enabled || !row.secret) return { ok: true, required: false, recoveryUsed: false };
      if (verifyTotp(row.secret, code, now)) return { ok: true, required: true, recoveryUsed: false };
      const recoveryHash = hashRecoveryCode(code);
      const index = Array.isArray(row.recoveryHashes) ? row.recoveryHashes.indexOf(recoveryHash) : -1;
      if (index >= 0) {
        row.recoveryHashes.splice(index, 1);
        writeJsonAtomic(filePath, rows);
        return { ok: true, required: true, recoveryUsed: true };
      }
      return { ok: false, required: true, recoveryUsed: false };
    });
  }

  function disable(username, code) {
    const result = verify(username, code);
    if (!result.ok || !result.required) throw mfaError('动态验证码或恢复码不正确', 'MFA_CODE_INVALID');
    return withJsonLock(lockPath, () => {
      const rows = readUnsafe();
      const row = rows.find(item => item.username === username);
      if (!row) return { enabled: false, enabledAt: null, recoveryCodesRemaining: 0, setupPending: false };
      row.enabled = false;
      row.secret = null;
      row.enabledAt = null;
      row.recoveryHashes = [];
      row.pendingSecret = null;
      row.pendingAt = null;
      writeJsonAtomic(filePath, rows);
      return { enabled: false, enabledAt: null, recoveryCodesRemaining: 0, setupPending: false };
    });
  }

  function rotateRecoveryCodes(username, code) {
    const result = verify(username, code);
    if (!result.ok || !result.required) throw mfaError('动态验证码或恢复码不正确', 'MFA_CODE_INVALID');
    return withJsonLock(lockPath, () => {
      const rows = readUnsafe();
      const row = rows.find(item => item.username === username);
      if (!row?.enabled) throw mfaError('MFA 尚未启用', 'MFA_NOT_ENABLED');
      const recoveryCodes = generateRecoveryCodes();
      row.recoveryHashes = recoveryCodes.map(hashRecoveryCode);
      writeJsonAtomic(filePath, rows);
      return { recoveryCodes, recoveryCodesRemaining: recoveryCodes.length };
    });
  }

  return { filePath, status, beginSetup, enable, verify, disable, rotateRecoveryCodes };
}

module.exports = { createMfaStore, verifyTotp, hotp, base32Encode, base32Decode };
