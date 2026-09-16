const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { listVisibleModels, resolveRuntimeModel } = require('../lib/model-catalog-runtime');
const { resolveTeamAuthorization } = require('../lib/api-access');
const { createConfigRouter } = require('../routes/config');

const ownerCatalog = {
  modelCatalogVersion: 1,
  modelCatalog: [{
    id: 'custom-owner-text',
    kind: 'text',
    displayName: '统一文本模型',
    providerType: 'custom',
    baseUrl: 'https://api.example.test/v1',
    modelId: 'owner-text',
    credential: 'owner-secret',
    enabled: true
  }]
};

function ownerMemberStore() {
  return {
    getMember: () => ({ username: 'owner', active: true, role: 'member', boundTo: null }),
    canUseApi: () => false
  };
}

function ownerAccountStore() {
  return { getInternalAccount: () => ({ username: 'owner', isOwner: true, active: true }) };
}

test('所有者即使成员档案误标为 member 也能读取并解析统一文本模型', () => {
  const options = {
    username: 'owner',
    kind: 'text',
    modelId: 'custom-owner-text',
    memberStore: ownerMemberStore(),
    accountStore: ownerAccountStore(),
    configReader: () => ownerCatalog
  };

  const visible = listVisibleModels(options);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].id, 'custom-owner-text');
  assert.equal(visible[0].hasCredential, true);
  assert.equal(resolveRuntimeModel(options).modelId, 'owner-text');
});

test('普通未绑定成员仍不能读取或解析管理员统一模型', () => {
  const options = {
    username: 'member',
    kind: 'text',
    modelId: 'custom-owner-text',
    memberStore: {
      getMember: () => ({ username: 'member', active: true, role: 'member', boundTo: null }),
      canUseApi: () => true
    },
    accountStore: { getInternalAccount: () => ({ username: 'member', isOwner: false, active: true }) },
    configReader: () => ownerCatalog
  };

  assert.deepEqual(listVisibleModels(options), []);
  assert.throws(() => resolveRuntimeModel(options), /当前账号没有可用的文本模型/);
});

test('所有者调用团队模型权限时不要求绑定管理员', () => {
  const access = resolveTeamAuthorization({
    username: 'owner',
    accountStore: ownerAccountStore(),
    memberStore: ownerMemberStore()
  });
  assert.equal(access.member.role, 'member');
  assert.equal(access.teamOwner, 'owner');
  assert.equal(access.billedTo, 'owner');
});

test('API 配置路由把所有者按模型管理者处理', async () => {
  const router = createConfigRouter({
    authenticate: (req, _res, next) => {
      req.username = 'owner';
      req.auth = { account: { username: 'owner', isOwner: true, active: true } };
      next();
    },
    memberStore: ownerMemberStore(),
    accountStore: ownerAccountStore(),
    configReader: () => ownerCatalog,
    configWriter: () => {}
  });
  const app = express();
  app.use('/api/config', router);
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/config/models?kind=text`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.models.length, 1);
    assert.equal(body.models[0].id, 'custom-owner-text');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
