const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createBatchFactoryConfigVersionStore } = require('../lib/batch-factory/config-version-store');

function createStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-batch-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return createBatchFactoryConfigVersionStore({ systemDir: path.join(root, 'system') });
}

test('batch config store seeds one published default version for production', t => {
  const store = createStore(t);
  const versions = store.listForProduction();
  assert.equal(versions.length, 1);
  assert.equal(versions[0].name, '默认批量生产');
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].status, 'published');
  assert.equal(versions[0].settings.productionMode, 'original');
  assert.equal(versions[0].settings.constraintPrefixEnabled, true);
});

test('publishing a new version archives the previous published snapshot', t => {
  const store = createStore(t);
  const draft = store.saveVersion({
    key: 'batch-production-default',
    name: '默认批量生产',
    note: '切换爆款开头并开启画质约束',
    settings: {
      productionMode: 'viral',
      aspectRatio: '16:9',
      constraintQualityEnabled: true,
      quality: '电影级灯光',
      ignoredSecret: 'must-not-persist'
    }
  });

  assert.equal(draft.version, 2);
  assert.equal(draft.status, 'draft');
  assert.equal(draft.settings.productionMode, 'viral');
  assert.equal(Object.hasOwn(draft.settings, 'ignoredSecret'), false);

  const published = store.publish(draft.key, draft.version);
  assert.equal(published.status, 'published');
  assert.equal(published.settings.productionMode, 'viral');

  const versions = store.list();
  const v1 = versions.find(item => item.version === 1);
  const v2 = versions.find(item => item.version === 2);
  assert.equal(v1.status, 'archived');
  assert.equal(v2.status, 'published');
  assert.equal(store.getPublished('batch-production-default').version, 2);
});
