const crypto = require('node:crypto');
const http = require('node:http');
const https = require('node:https');

const BOOK_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;
const VERSION_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

function assertBookID(bookId) {
  const value = String(bookId || '').trim();
  if (!BOOK_ID_PATTERN.test(value)) throw new Error('非法的书籍ID：' + value);
  return value;
}

function assertVersionID(versionId) {
  const value = String(versionId || '').trim();
  if (!VERSION_ID_PATTERN.test(value)) throw new Error('非法的版本ID：' + value);
  return value;
}

function sign(secret, { username, isOwner, issuedAt, method, pathname }) {
  return crypto.createHmac('sha256', secret).update([username, issuedAt, String(isOwner), method, pathname].join('\n')).digest('hex');
}

function createNovelFetchLifecycleClient({ targetBaseUrl, bridgeSecret, account } = {}) {
  if (!account?.username) throw new Error('当前登录账号不可用');
  const target = new URL(targetBaseUrl || process.env.QIANTIE_GO_BASE_URL || 'http://127.0.0.1:4000');
  const secret = bridgeSecret || process.env.QIANTIE_BRIDGE_SECRET || 'dev-bridge-secret-change-me';
  const transport = target.protocol === 'https:' ? https : http;

  function request(method, pathname, payload) {
    const issuedAt = String(Math.floor(Date.now() / 1000));
    const body = Buffer.from(JSON.stringify(payload || {}));
    return new Promise((resolve, reject) => {
      const upstream = transport.request({
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || undefined,
        method,
        path: pathname,
        timeout: 30_000,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Content-Length': String(body.length),
          'X-Qiantie-Username': account.username,
          'X-Qiantie-Is-Owner': String(account.isOwner === true),
          'X-Qiantie-Issued-At': issuedAt,
          'X-Qiantie-Signature': sign(secret, { username: account.username, isOwner: account.isOwner === true, issuedAt, method, pathname })
        }
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = {};
          try { parsed = raw ? JSON.parse(raw) : {}; } catch (_) { parsed = {}; }
          if ((response.statusCode || 500) >= 400) {
            const error = new Error(parsed.error || `小说获取正文生命周期服务返回 ${response.statusCode}`);
            error.status = response.statusCode || 503;
            reject(error);
            return;
          }
          resolve(parsed);
        });
      });
      upstream.on('timeout', () => upstream.destroy(new Error('小说获取正文生命周期服务响应超时')));
      upstream.on('error', () => reject(Object.assign(new Error('小说获取正文生命周期服务暂不可用，请稍后重试'), { status: 503 })));
      upstream.write(body);
      upstream.end();
    });
  }

  async function markBodyReleasable(bookId, versionId, retentionDays = 7) {
    const id = assertBookID(bookId);
    const version = assertVersionID(versionId);
    const days = Number.isInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 30 ? retentionDays : 7;
    return request('POST', `/api/novel-fetch-workshop/tasks/${encodeURIComponent(id)}/bodies/${encodeURIComponent(version)}/release`, { retentionDays: days });
  }

  async function cleanupBodies(reason = 'expired', limit = 100) {
    return request('POST', '/api/novel-fetch-workshop/bodies/cleanup', { reason, limit });
  }

  async function getBodyStorageStatus() {
    return request('GET', '/api/novel-fetch-workshop/bodies/status');
  }

  return { markBodyReleasable, cleanupBodies, getBodyStorageStatus };
}

module.exports = { createNovelFetchLifecycleClient };
