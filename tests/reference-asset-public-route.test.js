const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createNovelPanelPremiumStore } = require('../lib/novel-panel/premium-store');
const { issueReferenceAssetCapability } = require('../lib/novel-panel/reference-asset-capability');
const { createReferenceAssetPublicRouter } = require('../routes/reference-assets-public');

test('signed reference asset URL serves only the scoped image without bearer auth', async t => {
  const usersDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-reference-assets-'));
  t.after(() => fs.rmSync(usersDir, { recursive: true, force: true }));
  const store = createNovelPanelPremiumStore({ usersDir });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  store.writeReferenceAssetBytes('alice', 'character', 'hero', 'main', png, 'image/png');
  const laterAssetId = store.nextReferenceAssetId('alice', 'character', 'hero', 'main');
  assert.notEqual(laterAssetId, 'hero');

  const app = express();
  app.use('/api/reference-assets', createReferenceAssetPublicRouter({ usersDir, secret: 'test-capability-secret', now: () => 1_700_000_000_000 }));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const issued = issueReferenceAssetCapability({
    secret: 'test-capability-secret',
    origin: `http://127.0.0.1:${server.address().port}`,
    username: 'alice',
    assetType: 'character',
    assetId: 'hero',
    variant: 'main',
    now: () => 1_700_000_000_000,
    ttlSeconds: 600
  });
  const response = await fetch(issued);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);
});
