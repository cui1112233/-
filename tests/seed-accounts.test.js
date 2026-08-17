// 种子账号迁移：账号密码从环境变量读取，源码不含明文默认密码。
// 本文件在 require 前设置 QIANTIE_SEED_ACCOUNTS，模拟部署时通过环境变量注入种子账号。
process.env.QIANTIE_SEED_ACCOUNTS = JSON.stringify({
  choushiyiguai: '123456',
  choushiyiguai1: '123456',
  choushiyiguai2: '123456'
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { parseSeedAccounts, USERS } = require('../lib/shared');

function request(app, { method = 'GET', requestPath, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = require('node:http').createServer(app);
    const payload = body === undefined ? null : JSON.stringify(body);
    server.listen(0, '127.0.0.1', () => {
      const req = require('node:http').request({
        hostname: '127.0.0.1',
        port: server.address().port,
        path: requestPath,
        method,
        headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}
      }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          server.close(() => {
            const text = Buffer.concat(chunks).toString('utf8');
            resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
          });
        });
      });
      req.once('error', reject);
      if (payload) req.write(payload);
      req.end();
    });
  });
}

test('USERS is loaded from QIANTIE_SEED_ACCOUNTS environment variable', () => {
  assert.deepEqual(USERS, {
    choushiyiguai: '123456',
    choushiyiguai1: '123456',
    choushiyiguai2: '123456'
  });
});

test('parseSeedAccounts rejects malformed input', () => {
  assert.throws(() => parseSeedAccounts('not-json', '标签'), /JSON/);
  assert.throws(() => parseSeedAccounts('{"a":123}', '标签'), /密码/);
  assert.throws(() => parseSeedAccounts('[1,2]', '标签'), /JSON/);
});

test('createApp seeds env-configured account and login succeeds', async () => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-seed-env-'));
  try {
    const app = createApp({ accountStore: createAccountStore({ systemDir }), tokenMap: new Map() });
    const result = await request(app, {
      method: 'POST',
      requestPath: '/api/login',
      body: { username: 'choushiyiguai1', password: '123456' }
    });
    assert.equal(result.status, 200);
    assert.ok(result.body.token);
  } finally {
    fs.rmSync(systemDir, { recursive: true, force: true });
  }
});

test('ensureSeedAccounts with an empty object is a no-op and writes nothing', () => {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-seed-empty-'));
  try {
    const store = createAccountStore({ systemDir });
    const result = store.ensureSeedAccounts({});
    assert.equal(result, false);
    assert.equal(fs.existsSync(path.join(systemDir, 'accounts.json')), false);
    assert.equal(fs.existsSync(path.join(systemDir, 'seed-manifest.json')), false);
  } finally {
    fs.rmSync(systemDir, { recursive: true, force: true });
  }
});
