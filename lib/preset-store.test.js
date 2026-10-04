const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPresetStore } = require('./preset-store');

function createStore() {
  return createPresetStore({ systemDir: fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-preset-store-')) });
}

function draftBody(body) {
  return {
    id: 'batch-video-sd',
    module: 'batch-factory',
    name: 'SD 视频提示词',
    kind: 'base',
    description: '用于 SD 视频生成。',
    compatibleBaseIds: [],
    body,
    protocolLock: { slot: 'batch.video.sd' }
  };
}

test('updates a draft in place without creating another version', () => {
  const store = createStore();
  const created = store.createDraft('admin', draftBody('first draft'));

  const updated = store.updateDraft('admin', created.id, created.version, {
    ...draftBody('second draft'),
    expectedRevision: created.revision
  });

  assert.equal(updated.version, 1);
  assert.equal(updated.status, 'draft');
  assert.equal(store.listAll('batch-factory').length, 1);
  assert.equal(store.getVersion('batch-video-sd', 1).body, 'second draft');
  assert.equal(updated.revision, created.revision + 1);
  assert.equal(store.listAudit().at(-1).action, 'preset.draft_updated');
});

test('rejects updates to published versions and stale draft editors', () => {
  const store = createStore();
  const created = store.createDraft('admin', draftBody('draft'));
  const saved = store.updateDraft('admin', created.id, created.version, {
    ...draftBody('saved'),
    expectedRevision: created.revision
  });

  assert.throws(
    () => store.updateDraft('admin', created.id, created.version, { ...draftBody('stale'), expectedRevision: created.revision }),
    error => error.code === 'CONFLICT' && /changed/.test(error.message)
  );
  store.publish('admin', created.id, created.version);

  assert.throws(
    () => store.updateDraft('admin', created.id, created.version, { ...draftBody('changed'), expectedRevision: saved.revision }),
    error => error.code === 'CONFLICT' && /Only draft/.test(error.message)
  );
});
