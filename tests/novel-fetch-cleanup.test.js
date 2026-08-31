const test = require('node:test');
const assert = require('node:assert/strict');

const { planNovelFetchCleanup, runNovelFetchCleanup } = require('../lib/novel-fetch-workshop/cleanup');

const NOW = new Date('2026-08-31T12:00:00.000Z');
function daysAgo(days) { return new Date(NOW.getTime() - days * 86400000).toISOString(); }

test('cleanup only selects expired definite terminal ordinary tasks', () => {
  const tasks = [
    { bookId: 'done-old', status: 'done', updatedAt: daysAgo(45) },
    { bookId: 'submitted-old', status: 'submitted', updatedAt: daysAgo(60) },
    { bookId: 'done-recent', status: 'done', updatedAt: daysAgo(5) },
    { bookId: 'failed-old', status: 'failed', updatedAt: daysAgo(90) },
    { bookId: 'waiting-old', status: 'waiting_retry', updatedAt: daysAgo(90) },
    { bookId: 'scheduled-old', status: 'scheduled', updatedAt: daysAgo(90) },
    { bookId: 'tombstone-old', status: 'done', tombstoned: true, updatedAt: daysAgo(90) },
    { bookId: 'unknown-old', status: '', updatedAt: daysAgo(90) }
  ];
  const plan = planNovelFetchCleanup(tasks, { cleanup_enabled: true, retention_days: 30 }, NOW);
  assert.deepEqual(plan.deleteIds.sort(), ['done-old', 'submitted-old']);
  assert.equal(plan.kept, 6);
});

test('cleanup is fail-closed when disabled and dry-run never deletes', async () => {
  const deleted = [];
  const store = {
    listTasks: async () => [{ bookId: 'old', status: 'done', updatedAt: daysAgo(90) }],
    deleteTasks: async (_owner, ids) => { deleted.push(...ids); return { deleted: ids.length }; }
  };
  const disabled = await runNovelFetchCleanup({ owner: 'alice', store, policy: { cleanup_enabled: false, retention_days: 30 }, now: NOW });
  assert.equal(disabled.deleted, 0);
  const dry = await runNovelFetchCleanup({ owner: 'alice', store, policy: { cleanup_enabled: true, retention_days: 30 }, now: NOW, dryRun: true });
  assert.deepEqual(dry.deleteIds, ['old']);
  assert.deepEqual(deleted, []);
});

test('enabled cleanup deletes only planned ids for the same owner', async () => {
  const calls = [];
  const store = {
    listTasks: async owner => {
      assert.equal(owner, 'alice');
      return [
        { bookId: 'old', status: 'completed', updatedAt: daysAgo(40) },
        { bookId: 'keep', status: 'failed', updatedAt: daysAgo(100) }
      ];
    },
    deleteTasks: async (owner, ids) => { calls.push({ owner, ids }); return { deleted: ids.length }; }
  };
  const result = await runNovelFetchCleanup({ owner: 'alice', store, policy: { cleanup_enabled: true, retention_days: 30 }, now: NOW });
  assert.equal(result.deleted, 1);
  assert.deepEqual(calls, [{ owner: 'alice', ids: ['old'] }]);
});
