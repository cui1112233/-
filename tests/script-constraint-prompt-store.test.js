const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createScriptConstraintPromptStore } = require('../lib/script-constraint-prompt-store');

function createStore(t) {
  const systemDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-script-constraint-prompts-'));
  t.after(() => fs.rmSync(systemDir, { recursive: true, force: true }));
  return createScriptConstraintPromptStore({ systemDir });
}

test('keeps personal prompts private and moves actual usage to the top', t => {
  const store = createStore(t);
  const first = store.createOrSaveDraft('alice', { category: 'prefix', name: '暖色 2D', body: '二维动画暖色' });
  const second = store.createOrSaveDraft('alice', { category: 'prefix', name: '电影光影', body: '电影级光影' });
  assert.equal(store.getOwned('bob', first.id), null);
  store.markUsed('alice', [first.id]);
  assert.deepEqual(store.list('alice', 'prefix').map(item => item.id), [first.id, second.id]);
  store.markUsed('alice', [second.id]);
  assert.deepEqual(store.list('alice', 'prefix').map(item => item.id), [second.id, first.id]);
});

test('upserts one unnamed draft per user and category', t => {
  const store = createStore(t);
  const first = store.createOrSaveDraft('alice', { category: 'prefix', name: null, body: '第一版' });
  const second = store.createOrSaveDraft('alice', { category: 'prefix', name: null, body: '第二版' });
  assert.equal(second.id, first.id);
  assert.equal(store.list('alice', 'prefix').length, 1);
  assert.equal(store.getOwned('alice', first.id).body, '第二版');
});

test('rejects invalid personal prompt input', t => {
  const store = createStore(t);
  assert.throws(() => store.createOrSaveDraft('alice', { category: 'invalid', name: null, body: '正文' }), /Invalid personal prompt/);
  assert.throws(() => store.createOrSaveDraft('alice', { category: 'prefix', name: null, body: '' }), /Invalid personal prompt/);
  assert.throws(() => store.createOrSaveDraft('alice', { category: 'prefix', name: 'x'.repeat(81), body: '正文' }), /Invalid personal prompt/);
});
