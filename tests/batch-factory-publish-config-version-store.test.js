const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createBatchFactoryConfigVersionStore } = require('../lib/batch-factory/config-version-store');

function createStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-batch-publish-config-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return createBatchFactoryConfigVersionStore({ systemDir: path.join(root, 'system') });
}

test('publish config store seeds one published batch publish version', t => {
  const store = createStore(t);
  const versions = store.listForPublishing();
  assert.equal(versions.length, 1);
  assert.equal(versions[0].key, 'batch-publish-default');
  assert.equal(versions[0].name, '默认批量发布');
  assert.equal(versions[0].version, 1);
  assert.equal(versions[0].status, 'published');
  assert.deepEqual(versions[0].settings, {
    materialReuse: false,
    horizontalFlip: false
  });
});

test('publish config versions strip production settings and runtime account state', t => {
  const store = createStore(t);
  const draft = store.saveVersion({
    key: 'douyin-publish',
    name: '抖音批量发布',
    settings: {
      materialReuse: true,
      horizontalFlip: true,
      videoModelId: 99,
      productionMode: 'viral',
      jieyaVideoCount: 4,
      aiHead: '自定义AI头部',
      accountName: '小明',
      accountState: 'online',
      cookie: 'secret'
    }
  });

  assert.deepEqual(draft.settings, {
    materialReuse: true,
    horizontalFlip: true
  });
  assert.equal(Object.hasOwn(draft.settings, 'videoModelId'), false);
  assert.equal(Object.hasOwn(draft.settings, 'jieyaVideoCount'), false);
  assert.equal(Object.hasOwn(draft.settings, 'accountName'), false);
  assert.equal(Object.hasOwn(draft.settings, 'cookie'), false);
});

test('publishing a new publish version archives the previous published snapshot', t => {
  const store = createStore(t);
  const draft = store.saveVersion({
    key: 'batch-publish-default',
    name: '默认批量发布',
    settings: { materialReuse: true, horizontalFlip: false }
  });

  assert.equal(draft.version, 2);
  assert.equal(draft.status, 'draft');
  const published = store.publish(draft.key, draft.version);
  assert.equal(published.status, 'published');

  const versions = store.list();
  assert.equal(versions.find(item => item.version === 1).status, 'archived');
  assert.equal(versions.find(item => item.version === 2).status, 'published');
  assert.equal(store.getPublished('batch-publish-default').version, 2);
});
