const crypto = require('node:crypto');

const DEFAULT_TTL_SECONDS = 10 * 60;
const MAX_TTL_SECONDS = 15 * 60;

function text(value) {
  return String(value == null ? '' : value).trim();
}

function capabilityPayload({ username, assetType, assetId, variant, expiresAt }) {
  return [text(username), text(assetType), text(assetId), text(variant), String(expiresAt)].join('\n');
}

function capabilitySignature(secret, fields) {
  return crypto.createHmac('sha256', text(secret)).update(capabilityPayload(fields)).digest('hex');
}

function capabilityOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(text(origin));
  } catch {
    throw new Error('参考图片公网地址不合法');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) {
    throw new Error('参考图片公网地址必须使用 HTTP 或 HTTPS');
  }
  return parsed.origin;
}

function issueReferenceAssetCapability({ secret, origin, username, assetType, assetId, variant = 'main', ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now } = {}) {
  if (!text(secret)) throw new Error('参考图片签名密钥未配置');
  const fields = { username, assetType, assetId, variant };
  if (Object.values(fields).some(value => !text(value))) throw new Error('参考图片签名参数不完整');
  const ttl = Number.isFinite(Number(ttlSeconds)) ? Math.max(60, Math.min(MAX_TTL_SECONDS, Math.floor(Number(ttlSeconds)))) : DEFAULT_TTL_SECONDS;
  const expiresAt = Math.floor(Number(now()) / 1000) + ttl;
  const signature = capabilitySignature(secret, { ...fields, expiresAt });
  const path = `/api/reference-assets/h3/${encodeURIComponent(text(assetType))}/${encodeURIComponent(text(assetId))}/${encodeURIComponent(text(variant))}`;
  const url = new URL(path, `${capabilityOrigin(origin)}/`);
  url.search = new URLSearchParams({ u: text(username), e: String(expiresAt), s: signature }).toString();
  return url.toString();
}

function safeSignatureEqual(expected, received) {
  const expectedBuffer = Buffer.from(text(expected), 'utf8');
  const receivedBuffer = Buffer.from(text(received), 'utf8');
  return expectedBuffer.length === receivedBuffer.length && expectedBuffer.length > 0 && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
}

function verifyReferenceAssetCapability({ secret, username, assetType, assetId, variant = 'main', expiresAt, signature, now = Date.now } = {}) {
  const expiry = Number.parseInt(String(expiresAt || ''), 10);
  if (!text(secret) || !Number.isSafeInteger(expiry)) return false;
  if (expiry <= Math.floor(Number(now()) / 1000)) return false;
  const expected = capabilitySignature(secret, { username, assetType, assetId, variant, expiresAt: expiry });
  return safeSignatureEqual(expected, signature);
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  issueReferenceAssetCapability,
  verifyReferenceAssetCapability
};
