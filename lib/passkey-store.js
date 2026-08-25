const crypto = require('node:crypto');
const path = require('node:path');

const { readJsonOrMissing, writeJsonAtomic, withJsonLock } = require('./system-store');

const USERNAME_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SUPPORTED_ALGORITHMS = new Set([-7, -257]);

function passkeyError(message, code = 'INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function fromB64url(value) {
  try { return Buffer.from(String(value || ''), 'base64url'); } catch { return Buffer.alloc(0); }
}

function normalizeUsername(value) {
  const username = String(value || '').trim();
  if (!USERNAME_PATTERN.test(username)) throw passkeyError('账号不合法');
  return username;
}

function normalizeRpId(value) {
  const rpId = String(value || '').trim().toLowerCase().replace(/:\d+$/, '');
  if (!rpId || rpId.length > 253 || !/^[a-z0-9.-]+$/.test(rpId)) throw passkeyError('RP ID 不合法');
  return rpId;
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw passkeyError('Origin 不合法'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw passkeyError('Origin 不合法');
  if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw passkeyError('Passkey 仅允许 HTTPS 或本机开发环境');
  return url.origin;
}

function safeClientData(value, expectedType, expectedChallenge, expectedOrigin) {
  const bytes = fromB64url(value);
  if (!bytes.length) throw passkeyError('clientDataJSON 缺失');
  let data;
  try { data = JSON.parse(bytes.toString('utf8')); } catch { throw passkeyError('clientDataJSON 不合法'); }
  if (data.type !== expectedType) throw passkeyError('WebAuthn 类型不匹配');
  if (data.challenge !== expectedChallenge) throw passkeyError('WebAuthn challenge 已失效', 'CONFLICT');
  if (normalizeOrigin(data.origin) !== expectedOrigin) throw passkeyError('WebAuthn Origin 不匹配', 'FORBIDDEN');
  return { bytes, data };
}

function cloneCredential(item) {
  return {
    id: item.id,
    username: item.username,
    credentialId: item.credentialId,
    name: item.name,
    algorithm: item.algorithm,
    transports: [...(item.transports || [])],
    signCount: item.signCount || 0,
    createdAt: item.createdAt,
    lastUsedAt: item.lastUsedAt || null
  };
}

function createPasskeyStore({ systemDir } = {}) {
  if (!systemDir) throw new Error('systemDir is required');
  const filePath = path.join(systemDir, 'passkeys.json');
  const lockPath = path.join(systemDir, 'passkeys.lock');

  function emptyState() { return { credentials: [], challenges: [] }; }

  function readUnsafe() {
    const result = readJsonOrMissing(filePath);
    if (!result.found) return emptyState();
    const state = result.value;
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('Invalid passkey store');
    return {
      credentials: Array.isArray(state.credentials) ? state.credentials : [],
      challenges: Array.isArray(state.challenges) ? state.challenges : []
    };
  }

  function writeUnsafe(state) { writeJsonAtomic(filePath, state); }

  function pruneChallenges(state) {
    const now = Date.now();
    state.challenges = state.challenges.filter(item => !item.usedAt && Date.parse(item.expiresAt) > now);
  }

  function createChallenge(state, username, kind, rpId, origin) {
    pruneChallenges(state);
    state.challenges = state.challenges.filter(item => !(item.username === username && item.kind === kind));
    const challenge = b64url(crypto.randomBytes(32));
    const now = Date.now();
    const record = {
      id: crypto.randomUUID(), username, kind, challenge, rpId, origin,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CHALLENGE_TTL_MS).toISOString(),
      usedAt: null
    };
    state.challenges.push(record);
    return record;
  }

  function consumeChallenge(state, username, kind, challenge) {
    const record = state.challenges.find(item => item.username === username && item.kind === kind && item.challenge === challenge);
    if (!record) throw passkeyError('Passkey challenge 不存在', 'NOT_FOUND');
    if (record.usedAt || Date.parse(record.expiresAt) <= Date.now()) throw passkeyError('Passkey challenge 已失效', 'CONFLICT');
    record.usedAt = new Date().toISOString();
    return record;
  }

  function beginRegistration(usernameValue, { rpId: rpIdValue, origin: originValue, displayName } = {}) {
    const username = normalizeUsername(usernameValue);
    const rpId = normalizeRpId(rpIdValue);
    const origin = normalizeOrigin(originValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const challenge = createChallenge(state, username, 'register', rpId, origin);
      const existing = state.credentials.filter(item => item.username === username);
      writeUnsafe(state);
      return {
        challenge: challenge.challenge,
        rp: { id: rpId, name: '一战晟铭' },
        user: { id: b64url(Buffer.from(username, 'utf8')), name: username, displayName: String(displayName || username).slice(0, 64) },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        timeout: CHALLENGE_TTL_MS,
        attestation: 'none',
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
        excludeCredentials: existing.map(item => ({ type: 'public-key', id: item.credentialId, transports: item.transports || [] }))
      };
    });
  }

  function finishRegistration(usernameValue, payload = {}) {
    const username = normalizeUsername(usernameValue);
    const credentialId = String(payload.credentialId || payload.id || '').trim();
    const publicKeyDer = fromB64url(payload.publicKey);
    const algorithm = Number(payload.algorithm);
    if (!credentialId || credentialId.length > 2048) throw passkeyError('Passkey credential ID 不合法');
    if (!publicKeyDer.length || publicKeyDer.length > 4096) throw passkeyError('Passkey 公钥不合法');
    if (!SUPPORTED_ALGORITHMS.has(algorithm)) throw passkeyError('当前 Passkey 算法不受支持');
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const client = safeClientData(payload.clientDataJSON, 'webauthn.create', String(payload.challenge || ''), normalizeOrigin(payload.origin));
      const challenge = consumeChallenge(state, username, 'register', client.data.challenge);
      if (challenge.origin !== normalizeOrigin(payload.origin) || challenge.rpId !== normalizeRpId(payload.rpId)) throw passkeyError('Passkey 注册上下文不匹配', 'FORBIDDEN');
      if (state.credentials.some(item => item.credentialId === credentialId)) throw passkeyError('该 Passkey 已绑定', 'CONFLICT');
      let key;
      try { key = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' }); } catch { throw passkeyError('Passkey 公钥无法解析'); }
      const keyType = key.asymmetricKeyType;
      if (algorithm === -7 && keyType !== 'ec') throw passkeyError('Passkey 公钥算法不匹配');
      if (algorithm === -257 && keyType !== 'rsa') throw passkeyError('Passkey 公钥算法不匹配');
      const now = new Date().toISOString();
      const credential = {
        id: crypto.randomUUID(), username, credentialId,
        publicKey: b64url(publicKeyDer), algorithm,
        transports: Array.isArray(payload.transports) ? [...new Set(payload.transports.map(String))].slice(0, 8) : [],
        name: String(payload.name || 'Passkey').trim().slice(0, 60) || 'Passkey',
        signCount: 0,
        createdAt: now,
        lastUsedAt: null
      };
      state.credentials.push(credential);
      writeUnsafe(state);
      return cloneCredential(credential);
    });
  }

  function listCredentials(usernameValue) {
    const username = normalizeUsername(usernameValue);
    return withJsonLock(lockPath, () => readUnsafe().credentials.filter(item => item.username === username).map(cloneCredential));
  }

  function removeCredential(usernameValue, idValue) {
    const username = normalizeUsername(usernameValue);
    const id = String(idValue || '');
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const index = state.credentials.findIndex(item => item.username === username && item.id === id);
      if (index === -1) throw passkeyError('Passkey 不存在', 'NOT_FOUND');
      const [removed] = state.credentials.splice(index, 1);
      writeUnsafe(state);
      return cloneCredential(removed);
    });
  }

  function beginAuthentication(usernameValue, { rpId: rpIdValue, origin: originValue } = {}) {
    const username = normalizeUsername(usernameValue);
    const rpId = normalizeRpId(rpIdValue);
    const origin = normalizeOrigin(originValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const credentials = state.credentials.filter(item => item.username === username);
      if (!credentials.length) throw passkeyError('当前账号没有可用 Passkey', 'NOT_FOUND');
      const challenge = createChallenge(state, username, 'authenticate', rpId, origin);
      writeUnsafe(state);
      return {
        challenge: challenge.challenge,
        rpId,
        timeout: CHALLENGE_TTL_MS,
        userVerification: 'preferred',
        allowCredentials: credentials.map(item => ({ type: 'public-key', id: item.credentialId, transports: item.transports || [] }))
      };
    });
  }

  function finishAuthentication(usernameValue, payload = {}) {
    const username = normalizeUsername(usernameValue);
    const credentialId = String(payload.credentialId || payload.id || '').trim();
    const authenticatorData = fromB64url(payload.authenticatorData);
    const signature = fromB64url(payload.signature);
    if (!credentialId || authenticatorData.length < 37 || !signature.length) throw passkeyError('Passkey 登录数据不完整');
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const credential = state.credentials.find(item => item.username === username && item.credentialId === credentialId);
      if (!credential) throw passkeyError('Passkey 不存在', 'NOT_FOUND');
      const origin = normalizeOrigin(payload.origin);
      const rpId = normalizeRpId(payload.rpId);
      const client = safeClientData(payload.clientDataJSON, 'webauthn.get', String(payload.challenge || ''), origin);
      const challenge = consumeChallenge(state, username, 'authenticate', client.data.challenge);
      if (challenge.origin !== origin || challenge.rpId !== rpId) throw passkeyError('Passkey 登录上下文不匹配', 'FORBIDDEN');
      const expectedRpHash = crypto.createHash('sha256').update(rpId).digest();
      const rpHash = authenticatorData.subarray(0, 32);
      if (rpHash.length !== expectedRpHash.length || !crypto.timingSafeEqual(rpHash, expectedRpHash)) throw passkeyError('Passkey RP 校验失败', 'FORBIDDEN');
      const flags = authenticatorData[32];
      if ((flags & 0x01) === 0) throw passkeyError('Passkey 未确认用户存在', 'FORBIDDEN');
      const signCount = authenticatorData.readUInt32BE(33);
      const clientHash = crypto.createHash('sha256').update(client.bytes).digest();
      const signedData = Buffer.concat([authenticatorData, clientHash]);
      let publicKey;
      try { publicKey = crypto.createPublicKey({ key: fromB64url(credential.publicKey), format: 'der', type: 'spki' }); } catch { throw passkeyError('Passkey 公钥损坏'); }
      const verified = crypto.verify('sha256', signedData, publicKey, signature);
      if (!verified) throw passkeyError('Passkey 签名验证失败', 'FORBIDDEN');
      const previous = Number(credential.signCount || 0);
      if (previous > 0 && signCount > 0 && signCount <= previous) throw passkeyError('Passkey 计数器异常，请检查凭据是否被复制', 'FORBIDDEN');
      credential.signCount = Math.max(previous, signCount);
      credential.lastUsedAt = new Date().toISOString();
      writeUnsafe(state);
      return cloneCredential(credential);
    });
  }

  function purgeUser(usernameValue) {
    const username = normalizeUsername(usernameValue);
    return withJsonLock(lockPath, () => {
      const state = readUnsafe();
      const removed = state.credentials.filter(item => item.username === username).length;
      const hadChallenges = state.challenges.some(item => item.username === username);
      state.credentials = state.credentials.filter(item => item.username !== username);
      state.challenges = state.challenges.filter(item => item.username !== username);
      if (removed || hadChallenges) writeUnsafe(state);
      return removed;
    });
  }

  return {
    filePath,
    beginRegistration,
    finishRegistration,
    listCredentials,
    removeCredential,
    beginAuthentication,
    finishAuthentication,
    purgeUser
  };
}

module.exports = { createPasskeyStore, passkeyError, normalizeOrigin, normalizeRpId, CHALLENGE_TTL_MS };
