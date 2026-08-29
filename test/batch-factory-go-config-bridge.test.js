const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveConfigCatalogWithGo,
  resolvePresetWithGo,
  resolvePresetBodyWithGo
} = require('../lib/batch-factory/config-snapshot-bridge');

const rows = [
  { id: 'director', module: 'batch-factory', name: '导演', version: 1, status: 'archived', body: 'director-v1', publishedAt: '2026-08-20T00:00:00.000Z', protocolLock: { format: 'x' } },
  { id: 'director', module: 'batch-factory', name: '导演', version: 2, status: 'published', body: 'director-v2', publishedAt: '2026-08-21T00:00:00.000Z', protocolLock: { format: 'x' } }
];

function presetStore() {
  return {
    listAll(module) {
      assert.equal(module, 'batch-factory');
      return rows.map(row => ({ ...row, protocolLock: { ...row.protocolLock } }));
    }
  };
}

test('配置快照桥只把原始 preset 历史交给 Go 并返回 Go catalog', async () => {
  const calls = [];
  const catalog = { latest: { revision: 'abc123def456', label: '配置 v2', presetVersions: { director: 2 } }, versions: [] };
  const result = await resolveConfigCatalogWithGo({
    username: 'producer',
    isOwner: false,
    presetStore: presetStore(),
    requestBridge: async input => {
      calls.push(input);
      return { statusCode: 200, payload: catalog };
    }
  });
  assert.deepEqual(result, catalog);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].pathname, '/api/shuihuo-production/batch-factory/config-snapshots/resolve');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].body.presets, rows);
});

test('pinned preset 桥发送 id/version 并完全采用 Go 返回的历史版本', async () => {
  const calls = [];
  const expected = { id: 'director', module: 'batch-factory', name: '导演', version: 1, status: 'archived', body: 'director-v1' };
  const preset = await resolvePresetWithGo({
    username: 'producer',
    isOwner: true,
    presetStore: presetStore(),
    id: 'director',
    version: 1,
    requestBridge: async input => {
      calls.push(input);
      return { statusCode: 200, payload: { preset: expected } };
    }
  });
  assert.deepEqual(preset, expected);
  assert.equal(calls[0].pathname, '/api/shuihuo-production/batch-factory/presets/resolve');
  assert.deepEqual(calls[0].body, { presets: rows, id: 'director', version: 1 });
});

test('Go 错误原样传播，不回退 Node config-version 逻辑', async () => {
  await assert.rejects(() => resolveConfigCatalogWithGo({
    username: 'producer',
    presetStore: presetStore(),
    requestBridge: async () => ({ statusCode: 503, payload: { error: 'Go config unavailable' } })
  }), error => error.statusCode === 503 && /Go config unavailable/.test(error.message));

  await assert.rejects(() => resolvePresetWithGo({
    username: 'producer',
    presetStore: presetStore(),
    id: 'director',
    version: 1,
    requestBridge: async () => ({ statusCode: 404, payload: { error: 'preset missing' } })
  }), error => error.statusCode === 404 && /preset missing/.test(error.message));
});

test('Go 返回无效 preset 时按网关错误处理，不能本地 fallback', async () => {
  await assert.rejects(() => resolvePresetBodyWithGo({
    username: 'producer',
    presetStore: presetStore(),
    id: 'director',
    version: 1,
    requestBridge: async () => ({ statusCode: 200, payload: { preset: { id: 'director', version: 1, body: '   ' } } })
  }), error => error.statusCode === 502 && /无效/.test(error.message));
});
