const fs = require('node:fs/promises');
const path = require('node:path');

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/webp', '.webp'],
  ['image/png', '.png']
]);

function text(value) {
  return String(value == null ? '' : value).trim();
}

function configFromEnv(env = process.env) {
  const endpoint = text(env.QIANTIE_REFERENCE_ASSET_TOS_ENDPOINT).replace(/\/+$/, '');
  const region = text(env.QIANTIE_REFERENCE_ASSET_TOS_REGION);
  const bucket = text(env.QIANTIE_REFERENCE_ASSET_TOS_BUCKET);
  const accessKeyId = text(env.QIANTIE_REFERENCE_ASSET_TOS_ACCESS_KEY);
  const accessKeySecret = text(env.QIANTIE_REFERENCE_ASSET_TOS_SECRET_KEY);
  if (!endpoint || !region || !bucket || !accessKeyId || !accessKeySecret) return null;
  if (!/^https:\/\//i.test(endpoint)) throw new Error('TOS 参考图地址必须使用 HTTPS Endpoint');
  return { endpoint, region, bucket, accessKeyId, accessKeySecret };
}

// @volcengine/tos-sdk expects a bare host and composes bucket.host itself.
// Passing the configured URL (for example, https://tos-cn-beijing.volces.com)
// makes it build the invalid host "bucket.https".
function normalizeTosSdkEndpoint(value) {
  const parsed = new URL(text(value));
  return parsed.host;
}

function safeSegment(value, fallback = 'unknown') {
  const raw = text(value) || fallback;
  // Percent-encoding keeps Unicode and slash-containing usernames isolated
  // without allowing object-key path traversal.
  return encodeURIComponent(raw).replace(/%/g, '~').slice(0, 180);
}

function extensionFor(contentType, filePath = '') {
  const normalized = text(contentType).toLowerCase().split(';', 1)[0];
  return MIME_EXTENSIONS.get(normalized) || path.extname(filePath).toLowerCase() || '.bin';
}

function createTosReferenceAssetStore({ env = process.env, client } = {}) {
  const config = configFromEnv(env);
  if (!config) return null;
  let resolvedClient = client;
  if (!resolvedClient) {
    let TosClient;
    try {
      ({ TosClient } = require('@volcengine/tos-sdk'));
    } catch (error) {
      throw new Error(`TOS 参考图服务未安装：${error.message}`);
    }
    resolvedClient = new TosClient({
      ...config,
      endpoint: normalizeTosSdkEndpoint(config.endpoint),
      secure: true
    });
  }
  if (typeof resolvedClient.putObject !== 'function' || typeof resolvedClient.getPreSignedUrl !== 'function') {
    throw new Error('TOS 参考图客户端接口不完整');
  }

  function keyFor({ username, assetType, assetId, variant, contentType, filePath } = {}) {
    const ext = extensionFor(contentType, filePath);
    return `reference-assets/${safeSegment(username)}/${safeSegment(assetType)}/${safeSegment(assetId)}/${safeSegment(variant)}${ext}`;
  }

  async function put({ username, assetType, assetId, variant, body, contentType = 'application/octet-stream', filePath } = {}) {
    const payload = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
    if (!payload.length) throw new Error('TOS 参考图内容为空');
    const key = keyFor({ username, assetType, assetId, variant, contentType, filePath });
    await resolvedClient.putObject({
      bucket: config.bucket,
      key,
      body: payload,
      contentLength: payload.length,
      contentType,
      cacheControl: 'private, max-age=300'
    });
    return { key, size: payload.length };
  }

  async function putFile(input = {}) {
    const body = await fs.readFile(input.filePath);
    return put({ ...input, body });
  }

  function getSignedUrl(key, expires = 3600) {
    return resolvedClient.getPreSignedUrl({
      bucket: config.bucket,
      key: text(key),
      method: 'GET',
      expires: Math.max(60, Math.min(86400, Number(expires) || 3600))
    });
  }

  return { config: { endpoint: config.endpoint, region: config.region, bucket: config.bucket }, keyFor, put, putFile, getSignedUrl };
}

module.exports = { configFromEnv, createTosReferenceAssetStore, extensionFor, normalizeTosSdkEndpoint, safeSegment };
