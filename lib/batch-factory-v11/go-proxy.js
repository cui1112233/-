const crypto = require('crypto');

const BRIDGE_HEADERS = {
  username: 'X-Qiantie-Username',
  isOwner: 'X-Qiantie-Is-Owner',
  issuedAt: 'X-Qiantie-Issued-At',
  signature: 'X-Qiantie-Signature'
};

function bridgePayload({ username, issuedAt, isOwner, method, pathname }) {
  return `${username}${issuedAt}${isOwner}${method}${pathname}`;
}

function createSignedBridgeHeaders({ username, isOwner, method, pathname, secret, now = Date.now() }) {
  if (!username || !secret) throw new Error('trusted username and QIANTIE_BRIDGE_SECRET are required');
  const issuedAt = String(Math.floor(now / 1000));
  const owner = String(Boolean(isOwner));
  const signature = crypto.createHmac('sha256', secret)
    .update(bridgePayload({ username, issuedAt, isOwner: owner, method, pathname }))
    .digest('hex');
  return {
    [BRIDGE_HEADERS.username]: username,
    [BRIDGE_HEADERS.isOwner]: owner,
    [BRIDGE_HEADERS.issuedAt]: issuedAt,
    [BRIDGE_HEADERS.signature]: signature
  };
}

function serializeOpaqueBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return req.body;
  if (req.body === undefined) return undefined;
  return JSON.stringify(req.body);
}

async function proxyV11Request(req, res, { goBaseUrl, bridgeSecret, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  if (!fetchImpl) throw new Error('fetch implementation is required');
  const base = String(goBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://backend:4000').replace(/\/$/, '');
  const secret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || '';
  const originalUrl = req.originalUrl || req.url;
  const parsed = new URL(originalUrl, 'http://qiantie.local');
  const pathname = parsed.pathname;
  const signed = createSignedBridgeHeaders({
    username: req.username,
    isOwner: req.auth?.account?.isOwner === true,
    method: req.method,
    pathname,
    secret,
    now: now()
  });
  const headers = { ...signed };
  const contentType = req.get?.('content-type') || req.headers?.['content-type'];
  const requestId = req.get?.('x-request-id') || req.headers?.['x-request-id'];
  if (contentType) headers['Content-Type'] = contentType;
  if (requestId) headers['X-Request-ID'] = requestId;
  const upstream = await fetchImpl(`${base}${originalUrl}`, {
    method: req.method,
    headers,
    body: serializeOpaqueBody(req),
    redirect: 'manual'
  });
  const responseType = upstream.headers?.get?.('content-type');
  const responseRequestId = upstream.headers?.get?.('x-request-id');
  if (responseType) res.set('Content-Type', responseType);
  if (responseRequestId) res.set('X-Request-ID', responseRequestId);
  const payload = Buffer.from(await upstream.arrayBuffer());
  return res.status(upstream.status).send(payload);
}

module.exports = { BRIDGE_HEADERS, bridgePayload, createSignedBridgeHeaders, serializeOpaqueBody, proxyV11Request };
