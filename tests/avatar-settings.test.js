process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456' });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { DEFAULT_CONFIG } = require('../lib/shared');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    const finish = (error, response) => server.close(closeError => error || closeError ? reject(error || closeError) : resolve(response));
    server.listen(0, '127.0.0.1', () => {
      const req = http.request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        }
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => finish(null, { status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
      });
      req.once('error', error => finish(error));
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function createRuntime(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-avatar-'));
  const username = `avatar${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: '123456', [username]: '123456' });
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(path.join(__dirname, '..', 'data', 'users', username), { recursive: true, force: true }));
  return { accountStore, username };
}

test('avatar settings preserve the prior selection for invalid values', async t => {
  assert.equal(DEFAULT_CONFIG.avatar, null);
  const { normalizeAvatar } = require('../routes/config');
  assert.deepEqual(normalizeAvatar({ emoji: '🚀', background: '#7c3aed' }), { emoji: '🚀', background: '#7c3aed' });
  assert.equal(normalizeAvatar({ emoji: '🚀', background: 'red' }), null);

  const runtime = createRuntime(t);
  const app = createApp(runtime);
  const login = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: runtime.username, password: '123456' } });
  const token = login.body.token;
  const chosen = { emoji: '🚀', background: '#7c3aed' };
  const saved = await request(app, { method: 'POST', requestPath: '/api/config', token, body: { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'test', avatar: chosen } });
  assert.deepEqual(saved.body.avatar, chosen);
  const invalid = await request(app, { method: 'POST', requestPath: '/api/config', token, body: { provider: 'openai', baseUrl: 'https://example.test/v1', model: 'test', avatar: { emoji: '', background: 'red' } } });
  assert.deepEqual(invalid.body.avatar, chosen);
});
