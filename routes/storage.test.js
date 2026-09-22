const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { createStorageRouter } = require('./storage');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

async function withServer(auth, run, getStorageRootFn = () => null) {
  const app = express();
  app.use(createStorageRouter({ auth, getStorageRootFn }));
  app.use((req, res) => res.status(404).json({ error: 'Not found' }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    return await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

test('storage auth does not intercept unrelated public/static paths', async () => {
  let authCalls = 0;
  const response = await withServer(
    (req, res, next) => { authCalls += 1; next(); },
    baseUrl => fetch(`${baseUrl}/yizhan-icon.png`)
  );

  assert.equal(response.status, 404);
  assert.equal(authCalls, 0);
});

test('storage endpoints remain authenticated', async () => {
  let authCalls = 0;
  const response = await withServer(
    (req, res, next) => { authCalls += 1; next(); },
    baseUrl => fetch(`${baseUrl}/api/storage/list`)
  );

  assert.equal(response.status, 200);
  assert.equal(authCalls, 1);
});

test('retention preview is read-only and returns only eligible local candidates', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-storage-'));
  const file = path.join(root, '剧本生成', 'old.md');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'old');
  const old = Date.now() - 10 * 86400000;
  fs.utimesSync(file, new Date(old), new Date(old));
  const response = await withServer(
    (req, _res, next) => { req.username = 'alice'; next(); },
    baseUrl => fetch(`${baseUrl}/api/storage/retention-preview?days=7`),
    () => root
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.retentionDays, 7);
  assert.equal(body.candidates[0].name, '剧本生成/old.md');
  assert.equal(fs.existsSync(file), true);
});
