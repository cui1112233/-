const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { createAdminRouter } = require('./admin');
const { createPresetStore } = require('../lib/preset-store');

function draftBody(body) {
  return {
    id: 'batch-video-sd', module: 'batch-factory', name: 'SD 视频提示词', kind: 'base',
    description: '', compatibleBaseIds: [], body, protocolLock: { slot: 'batch.video.sd' }
  };
}

async function withAdminServer(run) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-admin-route-'));
  const accountStore = {
    files: { audit: path.join(systemDir, 'account-audit.json') },
    getAccount: username => username === 'admin' ? { username, active: true } : null,
    effectivePermissions: () => [],
    can: () => true
  };
  const presetStore = createPresetStore({ systemDir });
  const draft = presetStore.createDraft('admin', draftBody('first'));
  const app = express();
  app.use(express.json());
  app.locals.authRuntime = { accountStore, tokenMap: new Map([['token', { username: 'admin' }]]), sessionsPath: path.join(systemDir, 'sessions.json') };
  app.use('/api/admin', createAdminRouter(accountStore, presetStore, null, null));
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await run({ baseUrl: `http://127.0.0.1:${server.address().port}`, draft, presetStore });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('PUT draft endpoint updates the selected draft without creating a new version', async () => {
  await withAdminServer(async ({ baseUrl, draft, presetStore }) => {
    const response = await fetch(`${baseUrl}/api/admin/presets/batch-video-sd/${draft.version}/draft`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...draftBody('changed'), expectedRevision: draft.revision })
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).preset.version, draft.version);
    assert.equal(presetStore.listAll('batch-factory').length, 1);
    assert.equal(presetStore.getVersion('batch-video-sd', draft.version).body, 'changed');
  });
});
