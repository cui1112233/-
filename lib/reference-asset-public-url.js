const crypto = require('node:crypto');

const INTERNAL_REFERENCE_ASSET = /^\/api\/novel-panel\/reference-assets\/file\/(character|scene|prop)\/([A-Za-z0-9_-]{1,120})\/([A-Za-z0-9_-]{1,180})(?:\?.*)?$/;

function signingSecret() {
  return String(process.env.QIANTIE_REFERENCE_ASSET_SIGNING_SECRET || '').trim();
}

function publicBaseUrl() {
  const raw = String(process.env.QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!raw) return '';
  const parsed = new URL(raw);
  if (parsed.protocol !== 'https:') throw new Error('H3 参考图公网地址必须使用 HTTPS');
  return parsed.toString().replace(/\/$/, '');
}

function payload({ username, assetType, assetId, variant, expiresAt }) {
  return [username, assetType, assetId, variant, expiresAt].join('\n');
}

function signReferenceAsset(input) {
  const secret = signingSecret();
  if (!secret) throw new Error('H3 参考图签名密钥尚未配置');
  return crypto.createHmac('sha256', secret).update(payload(input)).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function verifyReferenceAssetSignature(input, signature) {
  const expiresAt = Number(input?.expiresAt);
  if (!Number.isInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return false;
  try { return safeEqual(signReferenceAsset(input), signature); } catch (_) { return false; }
}

function publicReferenceAssetUrl({ username, assetType, assetId, variant, ttlSeconds = 3600 }) {
  const base = publicBaseUrl();
  if (!base) throw new Error('H3 参考图需要配置 HTTPS 公网地址（QIANTIE_REFERENCE_ASSET_PUBLIC_BASE_URL）');
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(86400, Number(ttlSeconds) || 3600));
  const signature = signReferenceAsset({ username, assetType, assetId, variant, expiresAt });
  const target = new URL(`/api/novel-panel/reference-assets/public/${encodeURIComponent(username)}/${assetType}/${assetId}/${variant}`, `${base}/`);
  target.searchParams.set('expires', String(expiresAt));
  target.searchParams.set('sig', signature);
  return target.toString();
}

function h3ReferenceUrl(value, username) {
  const raw = String(value || '').trim();
  const match = INTERNAL_REFERENCE_ASSET.exec(raw);
  if (!match) return raw;
  return publicReferenceAssetUrl({ username, assetType: match[1], assetId: match[2], variant: match[3] });
}

module.exports = { h3ReferenceUrl, publicReferenceAssetUrl, verifyReferenceAssetSignature };
