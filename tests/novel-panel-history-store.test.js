const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createNovelPanelHistoryStore,
  historySummary,
  isValidHistoryId,
  newHistoryId
} = require('../lib/novel-panel/history-store');

function createTempStore(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qiantie-novel-panel-history-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    root,
    store: createNovelPanelHistoryStore({ usersDir: path.join(root, 'users') })
  };
}

function workspace(overrides = {}) {
  return {
    novel_text: '甲走进病房，看了一眼乙。',
    character_core_v2: {
      slots: [{ slot_id: 's1', display_name: '甲' }, { slot_id: 's2', display_name: '乙' }]
    },
    scenes: [{ id: 'scene_1' }],
    outline_shots: [
      { id: 'shot_1', duration: 2 },
      { id: 'shot_2', duration: 3.5 }
    ],
    ...overrides
  };
}

test('history summary computes source preview, characters, scenes, shots and duration', () => {
  const summary = historySummary(workspace());
  assert.equal(summary.source_preview, '甲走进病房，看了一眼乙。');
  assert.equal(summary.character_count, 2);
  assert.equal(summary.scene_count, 1);
  assert.equal(summary.shot_count, 2);
  assert.equal(summary.duration, 5.5);
});

test('history summary falls back to characters/scenes/outline_shots aliases and tolerates invalid durations', () => {
  const summary = historySummary({
    novelText: '  甲  看向乙。  ',
    characters: [{ name: '甲' }],
    scenes: [],
    outline_shots: [{ duration: 'bad' }, { duration: 1 }]
  });
  assert.equal(summary.source_preview, '甲 看向乙。');
  assert.equal(summary.character_count, 1);
  assert.equal(summary.shot_count, 2);
  assert.equal(summary.duration, 1);
});

test('history records are isolated per user', t => {
  const { store } = createTempStore(t);
  const record = store.createHistory('choushiyiguai', { note: '主账号', workspace: workspace() });
  assert.equal(isValidHistoryId(record.history_id), true);
  assert.equal(store.listHistory('choushiyiguai').length, 1);
  assert.equal(store.listHistory('choushiyiguai1').length, 0);
  assert.equal(store.readHistory('choushiyiguai1', record.history_id), null);
});

test('create, read, overwrite, note update and delete keep the record contract', t => {
  const { store } = createTempStore(t);
  const created = store.createHistory('choushiyiguai', {
    note: '第一版',
    workspace: workspace(),
    instruction_revision: 'rev-1'
  });
  assert.equal(created.schema, 'v77_history_v1');
  assert.match(created.history_id, /^hist_/);
  assert.equal(created.note, '第一版');
  assert.equal(created.instruction_revision, 'rev-1');
  assert.equal(created.workspace.novel_text, '甲走进病房，看了一眼乙。');
  assert.equal(store.listHistory('choushiyiguai')[0].instruction_revision, 'rev-1');

  const loaded = store.readHistory('choushiyiguai', created.history_id);
  assert.deepEqual(loaded.note, '第一版');
  assert.deepEqual(loaded.summary.shot_count, 2);

  const overwritten = store.overwriteHistory('choushiyiguai', created.history_id, {
    note: '第二版',
    workspace: workspace({ novel_text: '丙出现了。' }),
    instruction_revision: 'rev-2'
  });
  assert.equal(overwritten.note, '第二版');
  assert.equal(overwritten.instruction_revision, 'rev-2');
  assert.equal(overwritten.workspace.novel_text, '丙出现了。');
  assert.equal(overwritten.created_at, created.created_at);
  assert.notEqual(overwritten.updated_at, created.updated_at);

  const noted = store.updateHistoryNote('choushiyiguai', created.history_id, '备注已改');
  assert.equal(noted.note, '备注已改');
  assert.ok(noted.note_updated_at);

  assert.equal(store.deleteHistory('choushiyiguai', created.history_id), true);
  assert.equal(store.deleteHistory('choushiyiguai', created.history_id), false);
  assert.equal(store.readHistory('choushiyiguai', created.history_id), null);
});

test('history list sorts by updated_at descending and bounds the limit', t => {
  const { store } = createTempStore(t);
  const first = store.createHistory('choushiyiguai', { note: '旧', workspace: workspace() });
  const second = store.createHistory('choushiyiguai', { note: '新', workspace: workspace() });
  store.overwriteHistory('choushiyiguai', first.history_id, { note: '旧(已更新)', workspace: workspace() });

  const list = store.listHistory('choushiyiguai');
  assert.equal(list[0].history_id, first.history_id);
  assert.equal(list[1].history_id, second.history_id);
  assert.equal(store.listHistory('choushiyiguai', 1).length, 1);
});

test('history rejects invalid ids and unsafe workspace payloads', t => {
  const { store } = createTempStore(t);
  assert.equal(isValidHistoryId('hist_abc'), true);
  assert.equal(isValidHistoryId('other_abc'), false);
  assert.equal(isValidHistoryId('../hist_abc'), false);
  assert.throws(() => store.readHistory('choushiyiguai', '../escape'), /Invalid history id/);
  assert.throws(() => store.createHistory('choushiyiguai', { note: 'x', workspace: 'not-object' }), /Invalid history workspace/);
  assert.throws(() => store.createHistory('choushiyiguai', {
    note: 'x',
    workspace: JSON.parse('{"__proto__":{"polluted":true},"novel_text":"x"}')
  }), /Unsafe/);
});

test('history survives a reopened store over the same users directory', t => {
  const { root, store } = createTempStore(t);
  const record = store.createHistory('choushiyiguai', { note: '持久化', workspace: workspace() });
  const reopened = createNovelPanelHistoryStore({ usersDir: path.join(root, 'users') });
  assert.equal(reopened.readHistory('choushiyiguai', record.history_id).note, '持久化');
});

test('newHistoryId produces hist_-prefixed unique ids', () => {
  const ids = new Set(Array.from({ length: 50 }, () => newHistoryId(new Date(2026, 7, 18, 10, 0, 0))));
  assert.equal(ids.size, 50);
  for (const id of ids) assert.match(id, /^hist_20260818_100000_[0-9a-f]{8}$/);
});
