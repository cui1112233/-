const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const test = require('node:test');

const { createApp } = require('../app');
const { createAccountStore } = require('../lib/account-store');
const { createMemberStore } = require('../lib/member-store');

function makeRuntime() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-model-catalog-'));
  const systemDir = path.join(root, 'system');
  const accountStore = createAccountStore({ systemDir });
  accountStore.ensureSeedAccounts({ choushiyiguai: 'seed-password' });
  const memberStore = createMemberStore({ systemDir, accountStore });
  memberStore.createManagedMember('choushiyiguai', {
    username: 'manager', password: 'manager-password', displayName: 'Manager', role: 'manager'
  });
  memberStore.createManagedMember('manager', {
    username: 'member', password: 'member-password', displayName: 'Member', role: 'member', boundTo: 'manager'
  });
  const configs = new Map([['manager', {
    modelCatalogVersion: 1,
    modelCatalog: [{ id: 'minimax-h3-video', credential: 'manager-video-secret', enabled: true }]
  }]]);
  const app = createApp({
    accountStore,
    memberStore,
    tokenMap: new Map([['member-token', { username: 'member' }]]),
    sessionsPath: path.join(root, 'sessions.json'),
    configReader: username => configs.get(username) || { modelCatalogVersion: 1, modelCatalog: [] },
    configWriter: (username, config) => configs.set(username, config)
  });
  return { root, app, memberStore };
}

async function getModels(app) {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/models?kind=video`, {
      headers: { Authorization: 'Bearer member-token' }
    });
    return { status: response.status, body: await response.json() };
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('real app exposes only the bound manager enabled video model when member has video scope', async t => {
  const runtime = makeRuntime();
  t.after(() => fs.rmSync(runtime.root, { recursive: true, force: true }));
  runtime.memberStore.setApiAccess('manager', 'member', true, 'video');

  const response = await getModels(runtime.app);

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.models.map(model => model.id), ['minimax-h3-video']);
  assert.equal(JSON.stringify(response.body).includes('manager-video-secret'), false);
});

test('real app rejects a member without video scope before returning model choices', async t => {
  const runtime = makeRuntime();
  t.after(() => fs.rmSync(runtime.root, { recursive: true, force: true }));

  const response = await getModels(runtime.app);

  assert.equal(response.status, 403);
  assert.match(response.body.error, /尚未获得该类型 API 使用权限/);
});
