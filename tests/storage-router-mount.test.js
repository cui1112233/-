process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456' });
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');

function request(app, { method = 'GET', requestPath, body, token } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
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
        res.on('end', () => server.close(error => {
          if (error) return reject(error);
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
        }));
      });
      req.once('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

test('createApp mounts the authenticated storage router', async t => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-storage-router-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  const app = createApp({ accountStore: createAccountStore({ systemDir }), tokenMap: new Map() });
  const login = await request(app, { method: 'POST', requestPath: '/api/login', body: { username: 'choushiyiguai', password: '123456' } });
  const response = await request(app, { requestPath: '/api/storage/list', token: login.body.token });

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { scriptResults: [], novelFetch: [], novelAdapt: [], projects: [] });
});
