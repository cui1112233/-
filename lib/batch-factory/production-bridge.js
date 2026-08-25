const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

function signature(secret, { username, isOwner, issuedAt, method, pathname }) {
  const payload = [username, issuedAt, String(isOwner), method, pathname].join('\n');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function requestProductionBridge({ username, isOwner, pathname, body, targetBaseUrl, bridgeSecret, timeoutMs = 30000 }) {
  const target = new URL(targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const secret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me';
  const transport = target.protocol === 'https:' ? https : http;
  const method = 'POST';
  const issuedAt = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from(JSON.stringify(body || {}));
  const requestPath = pathname.startsWith('/') ? pathname : `/${pathname}`;

  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || undefined,
      method,
      path: requestPath,
      headers: {
        'X-Qiantie-Username': username,
        'X-Qiantie-Is-Owner': String(isOwner === true),
        'X-Qiantie-Issued-At': issuedAt,
        'X-Qiantie-Signature': signature(secret, { username, isOwner: isOwner === true, issuedAt, method, pathname: requestPath }),
        'Content-Type': 'application/json',
        'Content-Length': String(rawBody.length),
        Accept: 'application/json'
      },
      timeout: timeoutMs
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = {};
        try {
          payload = text ? JSON.parse(text) : {};
        } catch (_) {
          payload = { error: text || '生产服务返回了无效响应' };
        }
        resolve({ statusCode: response.statusCode || 502, payload });
      });
    });
    request.on('timeout', () => request.destroy(new Error('生产服务响应超时')));
    request.on('error', reject);
    request.write(rawBody);
    request.end();
  });
}

module.exports = { requestProductionBridge };
