const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createPresetStore } = require('../lib/preset-store');

function createTestStore(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-presets-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  return createPresetStore({ systemDir });
}

function draft(store, actor, overrides = {}) {
  return store.createDraft(actor, {
    id: 'novel-base',
    module: 'novel-panel',
    name: 'Novel Base',
    kind: 'base',
    description: 'Base protocol',
    compatibleBaseIds: [],
    body: 'SERVER_ONLY_BODY',
    protocolLock: { version: 1, rules: ['server-only'] },
    ...overrides
  });
}

test('draft creation creates immutable consecutive versions without exposing protected fields', t => {
  const store = createTestStore(t);

  const first = draft(store, 'editor');
  const second = draft(store, 'editor', { name: 'Novel Base v2', body: 'SERVER_ONLY_BODY_V2' });

  assert.deepEqual(first, {
    id: 'novel-base',
    module: 'novel-panel',
    name: 'Novel Base',
    kind: 'base',
    description: 'Base protocol',
    compatibleBaseIds: [],
    version: 1,
    status: 'draft'
  });
  assert.equal(second.version, 2);
  assert.equal(store.getVersion('novel-base', 1).body, 'SERVER_ONLY_BODY');
  assert.equal(store.getVersion('novel-base', 2).body, 'SERVER_ONLY_BODY_V2');
  assert.doesNotMatch(JSON.stringify(store.listAudit()), /SERVER_ONLY_BODY|protocolLock/);
});

test('only internal resolution includes bodies and it rejects invalid published selections', t => {
  const store = createTestStore(t);
  draft(store, 'editor');
  draft(store, 'editor', {
    id: 'novel-addon',
    name: 'Novel Addon',
    kind: 'addon',
    compatibleBaseIds: ['novel-base'],
    body: 'ADDON_SERVER_ONLY_BODY'
  });
  store.publish('publisher', 'novel-base', 1);
  store.publish('publisher', 'novel-addon', 1);

  const resolved = store.resolveSelection({
    module: 'novel-panel',
    presetIds: ['novel-base', 'novel-addon']
  });
  assert.equal(resolved.base.body, 'SERVER_ONLY_BODY');
  assert.equal(resolved.addons[0].body, 'ADDON_SERVER_ONLY_BODY');
  assert.throws(() => store.resolveSelection({
    module: 'novel-panel',
    presetIds: ['novel-base', 'novel-base']
  }), /duplicate/i);
  const baseOnly = store.resolveSelection({ module: 'novel-panel', presetIds: ['novel-base'] });
  assert.equal(baseOnly.base.id, 'novel-base');
  assert.deepEqual(baseOnly.addons, []);
});

test('selection rejects multiple bases, module mismatches, unpublished presets, and incompatible addons', t => {
  const store = createTestStore(t);
  draft(store, 'editor');
  draft(store, 'editor', { id: 'other-base', name: 'Other Base', body: 'OTHER_BASE' });
  draft(store, 'editor', {
    id: 'incompatible-addon',
    name: 'Incompatible Addon',
    kind: 'addon',
    compatibleBaseIds: ['other-base'],
    body: 'INCOMPATIBLE_ADDON'
  });
  draft(store, 'editor', {
    id: 'other-module-addon',
    module: 'other-panel',
    name: 'Other Module Addon',
    kind: 'addon',
    compatibleBaseIds: ['novel-base'],
    body: 'OTHER_MODULE_ADDON'
  });
  store.publish('publisher', 'novel-base', 1);
  store.publish('publisher', 'other-base', 1);
  store.publish('publisher', 'incompatible-addon', 1);
  store.publish('publisher', 'other-module-addon', 1);

  assert.throws(() => store.resolveSelection({
    module: 'novel-panel',
    presetIds: ['novel-base', 'other-base']
  }), /multiple base/i);
  assert.throws(() => store.resolveSelection({
    module: 'novel-panel',
    presetIds: ['novel-base', 'other-module-addon']
  }), /module/i);
  assert.throws(() => store.resolveSelection({
    module: 'novel-panel',
    presetIds: ['novel-base', 'incompatible-addon']
  }), /compatible/i);
  assert.throws(() => store.resolveSelection({
    module: 'novel-panel',
    presetIds: ['novel-base', 'missing-addon']
  }), /not published/i);
});

test('rollback restores an archived version without exposing protected fields in its audit', t => {
  const store = createTestStore(t);
  draft(store, 'editor', { body: 'VERSION_ONE_BODY' });
  store.publish('publisher', 'novel-base', 1);
  draft(store, 'editor', { body: 'VERSION_TWO_BODY' });
  store.publish('publisher', 'novel-base', 2);

  const restored = store.rollback('publisher', 'novel-base', 1);

  assert.equal(restored.version, 1);
  assert.equal(store.listCatalog('novel-panel')[0].version, 1);
  assert.doesNotMatch(JSON.stringify(store.listAudit()), /VERSION_(ONE|TWO)_BODY|protocolLock/);
});
