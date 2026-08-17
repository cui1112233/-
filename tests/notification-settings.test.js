process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({ choushiyiguai: '123456', choushiyiguai1: '123456', choushiyiguai2: '123456', choushiyiguai3: '123456', choushiyiguai4: '123456', choushiyiguai5: '123456' });
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
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-notifications-'));
  const username = `notify${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`;
  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: '123456', [username]: '123456' });
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  t.after(() => fs.rmSync(path.join(__dirname, '..', 'data', 'users', username), { recursive: true, force: true }));
  return { accountStore, tokenMap: new Map(), sessionsPath: path.join(systemDir, 'sessions.json'), username };
}

test('config provides default notification settings', () => {
  assert.deepEqual(DEFAULT_CONFIG.notifications, { soundEnabled: true, petVisible: true, soundVolume: 60 });
});

test('config route normalizes and persists notification settings', async t => {
  const { normalizeNotifications } = require('../routes/config');
  assert.deepEqual(normalizeNotifications(undefined), { soundEnabled: true, petVisible: true, soundVolume: 60 });
  assert.deepEqual(normalizeNotifications({ soundEnabled: false, petVisible: false }), { soundEnabled: false, petVisible: false, soundVolume: 60 });

  const runtime = createRuntime(t);
  const app = createApp(runtime);
  const login = await request(app, {
    method: 'POST',
    requestPath: '/api/login',
    body: { username: runtime.username, password: '123456' }
  });
  const token = login.body.token;
  const configPath = path.join(__dirname, '..', 'data', 'users', runtime.username, 'api-config.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ notifications: { soundEnabled: false, petVisible: false } }), 'utf8');
  const initial = await request(app, { requestPath: '/api/config', token });
  assert.deepEqual(initial.body.notifications, { soundEnabled: false, petVisible: false, soundVolume: 60 });

  async function save(notifications) {
    return request(app, {
      method: 'POST',
      requestPath: '/api/config',
      token,
      body: {
        provider: 'openai',
        baseUrl: 'https://example.test/v1',
        model: 'test',
        notifications
      }
    });
  }

  assert.equal((await save({ soundVolume: 100 })).body.notifications.soundVolume, 100);
  assert.equal((await save({ soundVolume: -1 })).body.notifications.soundVolume, 0);
  assert.equal((await save({ soundVolume: 120 })).body.notifications.soundVolume, 100);
  assert.equal((await save({ soundVolume: 100 })).body.notifications.soundVolume, 100);
  assert.equal((await save({ soundVolume: 'invalid' })).body.notifications.soundVolume, 60);
  assert.equal((await save({ soundVolume: 100 })).body.notifications.soundVolume, 100);

  const saved = await request(app, {
    method: 'POST',
    requestPath: '/api/config',
    token,
    body: {
      provider: 'openai',
      baseUrl: 'https://example.test/v1',
      model: 'test',
      notifications: { soundEnabled: false, petVisible: false }
    }
  });
  assert.deepEqual(saved.body.notifications, { soundEnabled: false, petVisible: false, soundVolume: 60 });
  const reread = await request(app, { requestPath: '/api/config', token });
  assert.deepEqual(reread.body.notifications, { soundEnabled: false, petVisible: false, soundVolume: 60 });
});
