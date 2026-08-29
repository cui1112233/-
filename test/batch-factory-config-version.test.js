const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listBatchFactoryConfigVersions,
  resolveVersionedPreset,
  resolveVersionedSystemPresetBody
} = require('../lib/batch-factory/config-version');

function fakePresetStore(rows) {
  return {
    listAll(module) {
      assert.equal(module, 'batch-factory');
      return rows.map(row => ({ ...row }));
    },
    getVersion(id, version) {
      const found = rows.find(row => row.id === id && row.version === version);
      return found ? { ...found } : null;
    },
    getPublished(id) {
      const found = rows.find(row => row.id === id && row.status === 'published');
      return found ? { ...found } : null;
    }
  };
}

const rows = [
  { id: 'director', module: 'batch-factory', name: '导演', version: 1, status: 'archived', body: 'director-v1', publishedAt: '2026-08-20T00:00:00.000Z' },
  { id: 'assets', module: 'batch-factory', name: '资产', version: 1, status: 'archived', body: 'assets-v1', publishedAt: '2026-08-20T00:01:00.000Z' },
  { id: 'director', module: 'batch-factory', name: '导演', version: 2, status: 'published', body: 'director-v2', publishedAt: '2026-08-21T00:00:00.000Z' },
  { id: 'assets', module: 'batch-factory', name: '资产', version: 2, status: 'published', body: 'assets-v2', publishedAt: '2026-08-22T00:00:00.000Z' }
];

test('配置版本按完整 published 状态生成历史快照并保留后台最新快照', () => {
  const catalog = listBatchFactoryConfigVersions(fakePresetStore(rows));
  assert.equal(catalog.versions.length, 3);
  assert.deepEqual(catalog.versions.map(item => item.presetVersions), [
    { assets: 1, director: 1 },
    { assets: 1, director: 2 },
    { assets: 2, director: 2 }
  ]);
  assert.deepEqual(catalog.latest.presetVersions, { assets: 2, director: 2 });
  assert.equal(catalog.latest.revision, catalog.versions[2].revision);
  assert.match(catalog.latest.label, /^配置 v3/);
});

test('历史 preset 版本可以按批次冻结的版本号解析', () => {
  const store = fakePresetStore(rows);
  const historical = resolveVersionedPreset(store, 'director', 1);
  assert.equal(historical.body, 'director-v1');
  assert.equal(historical.version, 1);

  const pinnedBody = resolveVersionedSystemPresetBody(store, 'director', {
    systemPresetVersions: { director: 1 }
  });
  assert.equal(pinnedBody, 'director-v1');

  const latestBody = resolveVersionedSystemPresetBody(store, 'director', {});
  assert.equal(latestBody, 'director-v2');
});
