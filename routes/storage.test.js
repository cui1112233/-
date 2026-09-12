const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { createStorageRouter } = require('./storage');

async function withServer(auth, run) {
  const app = express();
  app.use(createStorageRouter({ auth, getStorageRootFn: () => null }));
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
