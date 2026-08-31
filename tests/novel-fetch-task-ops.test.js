const test = require('node:test');
const assert = require('node:assert/strict');

const { createNovelFetchTaskOps, filterTaskList } = require('../lib/novel-fetch-workshop/task-ops');

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
