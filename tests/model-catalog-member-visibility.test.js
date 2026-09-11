const assert = require('node:assert/strict');
const test = require('node:test');

const { listVisibleModels, resolveRuntimeModel } = require('../lib/model-catalog-runtime');

function memberStoreFor(members, scopes = {}) {
  return {
    getMember(username) {
      return members[username] || null;
    },
    canUseApi(username, scope) {
      return (scopes[username] || []).includes('*') || (scopes[username] || []).includes(scope);
    }
  };
}

function managerConfig() {
  return {
    modelCatalogVersion: 1,
    modelCatalog: [
      { id: 'text-gpt54', kind: 'text', displayName: 'GPT-5.4', credential: 'manager-text-secret', enabled: true },
      { id: 'minimax-h3-video', displayName: 'MiniMax H3 多图生视频', credential: 'manager-video-secret', enabled: true },
      { id: 'yd2-mini-video', credential: 'disabled-video-secret', enabled: false },
      { id: 'image-flux', kind: 'image', displayName: 'Flux', credential: 'manager-image-secret', enabled: true }
    ]
  };
}

test('member sees only enabled video models from its bound manager without credentials', () => {
  const memberStore = memberStoreFor({
    manager: { username: 'manager', active: true, role: 'manager' },
    member: { username: 'member', active: true, role: 'member', boundTo: 'manager' }
  }, { member: ['video'] });

  const models = listVisibleModels({
    username: 'member',
    kind: 'video',
    memberStore,
    configReader: username => username === 'manager' ? managerConfig() : {}
  });

  assert.deepEqual(models.map(model => model.id), ['minimax-h3-video']);
  assert.equal(JSON.stringify(models).includes('manager-video-secret'), false);
  assert.equal(JSON.stringify(models).includes('disabled-video-secret'), false);
});

test('server rejects a text model submitted to an image operation', () => {
  const memberStore = memberStoreFor({
    manager: { username: 'manager', active: true, role: 'manager' },
    member: { username: 'member', active: true, role: 'member', boundTo: 'manager' }
  }, { member: ['image'] });

  assert.throws(() => resolveRuntimeModel({
    username: 'member',
    kind: 'image',
    modelId: 'text-gpt54',
    memberStore,
    configReader: username => username === 'manager' ? managerConfig() : {}
  }), /图片模型/);
});

test('member without the matching API scope sees no manager models', () => {
  const memberStore = memberStoreFor({
    manager: { username: 'manager', active: true, role: 'manager' },
    member: { username: 'member', active: true, role: 'member', boundTo: 'manager' }
  }, { member: ['text'] });

  assert.deepEqual(listVisibleModels({
    username: 'member',
    kind: 'video',
    memberStore,
    configReader: username => username === 'manager' ? managerConfig() : {}
  }), []);
});
