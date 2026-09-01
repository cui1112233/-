const test = require('node:test');
const assert = require('node:assert/strict');

const { createNovelFetchTaskOps, filterTaskList, toV78Task } = require('../lib/novel-fetch-workshop/task-ops');

function fakeTombstones() {
  const map = new Map();
  const setFor = owner => { if (!map.has(owner)) map.set(owner, new Set()); return map.get(owner); };
  return {
    add(owner, ids) { for (const id of ids) setFor(owner).add(id); },
    restore(owner, id) { return setFor(owner).delete(id); },
    has(owner, id) { return setFor(owner).has(id); },
    list(owner) { return [...setFor(owner)].map(bookId => ({ bookId })); }
  };
}

test('permanent delete removes tasks then blocks re-import until tombstone restore', async () => {
  const events = [];
  const tombstones = fakeTombstones();
  const store = {
    async deleteTasks(owner, ids) { events.push(['delete', owner, ids]); return { deleted: ids.length }; }
  };
  const ops = createNovelFetchTaskOps({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    tombstones,
    parseBooks: ({ inputText }) => ({ tasks: inputText.split(/\s+/).filter(Boolean).map(bookId => ({ bookId })) })
  });
  const result = await ops.permanentDelete('alice', ['book-a']);
  assert.deepEqual(result, { deleted: 1, tombstoned: ['book-a'] });
  assert.deepEqual(events, [['delete', 'alice', ['book-a']]]);
  assert.deepEqual(ops.processConflicts('alice', { input_text: 'book-a book-b' }), ['book-a']);
  assert.equal(ops.restoreTombstone('alice', 'book-a'), true);
  assert.deepEqual(ops.processConflicts('alice', { input_text: 'book-a' }), []);
});

test('task list defaults to today plus historical unfinished and supports date/bookId/status filters', () => {
  const tasks = [
    { bookId: 'today-done', status: 'done', updatedAt: '2026-08-31T09:00:00.000Z' },
    { bookId: 'old-failed', status: 'original_failed', error: 'x', updatedAt: '2026-08-30T09:00:00.000Z' },
    { bookId: 'old-done', status: 'done', updatedAt: '2026-08-30T08:00:00.000Z' },
    { bookId: 'older-running', status: 'running', updatedAt: '2026-08-29T08:00:00.000Z' }
  ];
  const now = new Date('2026-08-31T12:00:00.000Z');
  assert.deepEqual(filterTaskList(tasks, {}, now).map(item => item.bookId), ['today-done', 'old-failed', 'older-running']);
  assert.deepEqual(filterTaskList(tasks, { date: '2026-08-30' }, now).map(item => item.bookId), ['old-failed', 'old-done']);
  assert.deepEqual(filterTaskList(tasks, { bookId: 'old-' }, now).map(item => item.bookId), ['old-failed', 'old-done']);
  assert.deepEqual(filterTaskList(tasks, { status: 'done' }, now).map(item => item.bookId), ['today-done', 'old-done']);
});

test('batch AI count rejects the whole update when any selected task already has AI versions', async () => {
  const updates = [];
  const docs = {
    a: { meta: { bookId: 'a' }, document: { versions: {} } },
    b: { meta: { bookId: 'b' }, document: { versions: { ai1: 'text' } } }
  };
  const store = {
    async getTask(owner, id) { return docs[id] || null; },
    async updateTaskMeta(owner, id, patch) { updates.push([owner, id, patch]); }
  };
  const ops = createNovelFetchTaskOps({ accountResolver: owner => ({ username: owner }), createStore: () => store, tombstones: fakeTombstones(), parseBooks: () => ({ tasks: [] }) });
  const conflict = await ops.setAiCount('alice', ['a', 'b'], 3);
  assert.equal(conflict.ok, false);
  assert.deepEqual(conflict.conflicts, ['b']);
  assert.deepEqual(updates, []);

  const done = await ops.setAiCount('alice', ['a'], 4);
  assert.equal(done.ok, true);
  assert.deepEqual(updates, [['alice', 'a', { aiCount: 4 }]]);
  await assert.rejects(() => ops.setAiCount('alice', ['a'], 21), /1.*20/);
});

test('manual sensitive reprocess uses the V2 saved-rule processor and supports restoring raw original first', async () => {
  const events = [];
  const docs = {
    a: { meta: { bookId: 'a', status: 'done' }, document: { versions: {} } }
  };
  const config = { sensitive_ai: { mode: 'ai_group', enabled: true }, ai_assignments: { sensitive_fix: 'preset-sensitive' } };
  const store = {
    async getConfig() { return config; },
    async listTasks() { return [docs.a.meta]; },
    async getTask(_owner, id) { return docs[id] || null; },
    async restoreOriginal(owner, id) { events.push(['restore', owner, id]); },
    async appendLog(owner, id, event, data) { events.push(['log', owner, id, event, data]); }
  };
  const ops = createNovelFetchTaskOps({
    accountResolver: owner => ({ username: owner }),
    createStore: () => store,
    tombstones: fakeTombstones(),
    parseBooks: () => ({ tasks: [] }),
    createConfigSnapshot: (_tasks, saved) => ({ getConfig: () => saved, getAiConfig: () => ({ ai: {}, ai_presets: [], ai_assignments: saved.ai_assignments }) }),
    applySavedRules: async (tasks, owner, id, saved, configStore) => {
      assert.equal(tasks, store);
      assert.equal(saved.sensitive_ai.mode, 'ai_group');
      assert.equal(configStore.getAiConfig().ai_assignments.sensitive_fix, 'preset-sensitive');
      events.push(['apply', owner, id]);
      return true;
    }
  });
  const result = await ops.reprocessSensitive('alice', { mode: 'selected', ids: ['a'], restore_from_backup: true });
  assert.equal(result.processed, 1);
  assert.equal(result.restored, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(events.slice(0, 2), [['restore', 'alice', 'a'], ['apply', 'alice', 'a']]);
  assert.equal(events.some(entry => entry[0] === 'log' && entry[3] === 'sensitive_reprocessed' && entry[4].mode === 'ai_group'), true);
});

test('V78 task serializer preserves legacy snake_case fields for the existing workbench', () => {
  const task = toV78Task({
    bookId: '123', bookName: '书名', platformId: '15', platformName: '知乎付费', parseMode: 'smart',
    originalStatus: 'done', originalChars: 88, aiStatus: 'done', aiCount: 3, aiGeneratedCount: 2,
    classifyStatus: 'classified', classifierModel: 'm', sensitiveHitCount: 4, siteSubmitStatus: 'queued'
  });
  assert.equal(task.id, '123');
  assert.equal(task.book_id, '123');
  assert.equal(task.book_name, '书名');
  assert.equal(task.platform_id, '15');
  assert.equal(task.platform_name, '知乎付费');
  assert.equal(task.parse_mode, 'smart');
  assert.equal(task.original_status, 'done');
  assert.equal(task.original_chars, 88);
  assert.equal(task.ai_status, 'done');
  assert.equal(task.ai_count, 3);
  assert.deepEqual(task.ai_files, ['ai1', 'ai2']);
  assert.equal(task.classify_status, 'classified');
  assert.equal(task.classifier_model, 'm');
  assert.equal(task.sensitive_hit_count, 4);
  assert.equal(task.site_submit_status, 'queued');
});
