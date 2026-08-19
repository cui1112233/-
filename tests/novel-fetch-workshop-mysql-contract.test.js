const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createNovelFetchWorkshopRouter } = require('../routes/novel-fetch-workshop');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('novel-fetch workshop runtime records use the signed MySQL gateway instead of JSON files', () => {
  const gateway = read('routes/novel-fetch-workshop.js');
  const client = read('lib/novel-fetch-workshop/mysql-store.js');
  const router = read('backend/internal/httpapi/router.go');
  const migrations = read('backend/internal/storage/migrations.go');

  assert.match(gateway, /createMySQLWorkshopStore/);
  assert.match(client, /\/api\/novel-fetch-workshop\/tasks/);
  assert.doesNotMatch(client, /writeJsonAtomic|readJsonOrMissing|usersDir|pathForAiVersion/);
  assert.match(router, /\/novel-fetch-workshop\/tasks/);
  assert.match(migrations, /novel_fetch_workshop_tasks/);
  assert.match(migrations, /novel_fetch_workshop_settings/);
});

test('workshop config is forwarded to Go with the current signed account', async t => {
  const secret = 'workshop-bridge-secret';
  const backend = http.createServer((req, res) => {
    const issuedAt = req.headers['x-qiantie-issued-at'];
    const payload = ['writer-a', issuedAt, 'false', 'GET', '/api/novel-fetch-workshop/config'].join('\n');
    const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
    assert.equal(req.headers['x-qiantie-signature'], signature);
    assert.equal(req.headers['x-qiantie-username'], 'writer-a');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ settings: { workflow: { auto_fetch_original: false } } }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  t.after(() => backend.close());

  const app = express();
  app.use(express.json());
  app.use('/api/novel-fetch-workshop', createNovelFetchWorkshopRouter({
    auth: (req, res, next) => { req.username = 'writer-a'; req.auth = { account: { username: 'writer-a', isOwner: false } }; next(); },
    targetBaseUrl: `http://127.0.0.1:${backend.address().port}`,
    bridgeSecret: secret
  }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const result = await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${server.address().port}/api/novel-fetch-workshop/config`, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    }).on('error', reject);
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.appConfig.workflow.auto_fetch_original, false);
});
